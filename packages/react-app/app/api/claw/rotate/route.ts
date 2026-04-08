// POST /api/claw/rotate
// Cron/recovery worker: scans recent GameStarted logs, ensures every pending
// session has a batch assignment, then settles pending + auto-claims settled.
//
// Uses the same shared settle logic as /api/claw/settle — no duplication
// of assignment or proof-loading code.

import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabaseClient";
import clawAbi from "@/contexts/akibaClawGame.json";
import batchRngAbi from "@/contexts/merkleBatchRng.json";
import {
  getClients,
  settleSession,
  assignBatchPlay,
  logSettle,
} from "@/lib/server/clawAssign";

const CLAW_GAME = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;
const BATCH_RNG = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
  "0x249Ce901411809a8A0fECa6102D9F439bbf3751e") as `0x${string}`;
const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RELAYER_PK = process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "";
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_CLAW_DEPLOY_BLOCK ?? "61599859");

// Session status values (mirror Solidity enum)
const SS = { NONE: 0, PENDING: 1, SETTLED: 2, CLAIMED: 3, BURNED: 4, REFUNDED: 5 };

export async function POST(_req: Request) {
  if (!RELAYER_PK || RELAYER_PK.length < 10) {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 500 });
  }

  const { pub, wal, account } = getClients();
  const results: {
    activeBatch?: object;
    retried: object[];
    autoClaimed: object[];
    skipped: object[];
    errors: object[];
  } = { retried: [], autoClaimed: [], skipped: [], errors: [] };

  try {
    // ── 1. Report active batch status ──────────────────────────────────────
    try {
      const inv = (await pub.readContract({
        address: BATCH_RNG,
        abi: batchRngAbi,
        functionName: "getActiveBatchInventory",
      })) as any;
      results.activeBatch = {
        batchId: inv.batchId.toString(),
        totalRemaining: inv.totalRemaining.toString(),
        active: inv.active,
      };
    } catch {
      results.activeBatch = { error: "could not read batch inventory" };
    }

    // ── 2. Scan recent GameStarted logs ────────────────────────────────────
    const currentBlock = await pub.getBlockNumber();
    const fromBlock = currentBlock > 2000n ? currentBlock - 2000n : DEPLOY_BLOCK;

    let logs: any[] = [];
    try {
      logs = await pub.getLogs({
        address: CLAW_GAME,
        event: {
          name: "GameStarted",
          type: "event",
          inputs: [
            { indexed: true, name: "sessionId", type: "uint256" },
            { indexed: true, name: "player", type: "address" },
            { indexed: true, name: "tierId", type: "uint8" },
            { indexed: false, name: "playCost", type: "uint256" },
            { indexed: false, name: "requestBlock", type: "uint256" },
          ],
        },
        fromBlock,
        toBlock: currentBlock,
      });
    } catch {
      // Some RPC providers reject large range queries — fall through with empty
    }

    // ── 3. Process each session ────────────────────────────────────────────
    for (const logEntry of logs) {
      const sessionId = (logEntry.args as any).sessionId as bigint | undefined;
      if (!sessionId) continue;

      const sessionIdStr = sessionId.toString();

      try {
        const session = (await pub.readContract({
          address: CLAW_GAME,
          abi: clawAbi.abi,
          functionName: "getSession",
          args: [sessionId],
        })) as any;

        const status = Number(session.status);

        // ── Pending: ensure assignment exists, then settle ─────────────
        if (status === SS.PENDING) {
          // Pre-flight: check if we already have an assignment
          const { data: existingAssign } = await supabase
            .from("claw_batch_plays")
            .select("batch_id, play_index, commit_status")
            .eq("session_id", sessionIdStr)
            .single();

          // Skip sessions that are already claimed in our DB (chain may lag)
          if (existingAssign?.commit_status === "claimed") {
            results.skipped.push({ sessionId: sessionIdStr, reason: "already_claimed_in_db" });
            continue;
          }

          // Attempt settle (assigns if needed inside settleSession)
          const result = await settleSession(sessionId, pub, wal, account);

          if (result.ok) {
            results.retried.push({
              sessionId: sessionIdStr,
              txHash: result.txHash,
              rewardClass: result.rewardClass,
            });
          } else if (result.retryable) {
            // Soft failure — will be retried on next cron run
            results.skipped.push({ sessionId: sessionIdStr, reason: result.reason });
          } else {
            results.errors.push({ sessionId: sessionIdStr, stage: "settle", err: result.reason });
          }
        }

        // ── Settled on-chain but not yet claimed: direct claim ─────────
        // This handles the edge case where commitOutcome succeeded but
        // claimReward was not reached (e.g. the process was killed mid-flight).
        if (status === SS.SETTLED) {
          try {
            const claimH = await wal.writeContract({
              address: CLAW_GAME,
              abi: clawAbi.abi,
              functionName: "claimReward",
              args: [sessionId],
              account,
              chain: celo,
            });
            await pub.waitForTransactionReceipt({ hash: claimH, confirmations: 1, timeout: 90_000 });
            await logSettle(sessionIdStr, "autoclaim", claimH, true);

            // Sync DB status
            await supabase
              .from("claw_batch_plays")
              .update({ commit_status: "claimed", settled_at: new Date().toISOString() })
              .eq("session_id", sessionIdStr);

            results.autoClaimed.push({ sessionId: sessionIdStr, tx: claimH });
          } catch (e: any) {
            results.errors.push({ sessionId: sessionIdStr, stage: "autoclaim", err: e?.message });
          }
        }

        // Claimed/Burned/Refunded — nothing to do
      } catch (e: any) {
        results.errors.push({ sessionId: sessionIdStr, stage: "read", err: e?.message });
      }
    }

    return NextResponse.json({ ok: true, ...results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
