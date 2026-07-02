// POST /api/claw/sessions/recover
// Bounded backend recovery for sessions started before the local index existed.
// The browser never scans logs; it asks this route to recover server-side.

import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { requireSession } from "@/lib/auth";
import clawAbi from "@/contexts/akibaClawGame.json";
import {
  CLAW_SESSIONS_SETUP_MESSAGE,
  GAME_STARTED_EVENT,
  isClawSessionsSetupError,
  listClawSessionsForPlayer,
  upsertClawSession,
} from "@/lib/server/clawSessions";

const CLAW_GAME = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;
const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_CLAW_DEPLOY_BLOCK ?? "61599859");
const RECOVERY_BLOCKS = BigInt(process.env.CLAW_SESSION_RECOVERY_BLOCKS ?? "17280");
const LOG_CHUNK = 900n;
const ID_SCAN_LIMIT = Number(process.env.CLAW_SESSION_RECOVERY_ID_SCAN_LIMIT ?? "750");

const SS = { PENDING: 1, SETTLED: 2 };

function getSessionField(raw: any, name: string, index: number) {
  return raw?.[name] ?? raw?.[index];
}

export async function POST(_req: Request) {
  try {
    const appSession = await requireSession();
    if (!appSession) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const player = appSession.walletAddress.toLowerCase() as `0x${string}`;
    const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });
    const currentBlock = await pub.getBlockNumber();
    const lookbackStart = currentBlock > RECOVERY_BLOCKS
      ? currentBlock - RECOVERY_BLOCKS
      : DEPLOY_BLOCK;
    const fromBlock = lookbackStart > DEPLOY_BLOCK ? lookbackStart : DEPLOY_BLOCK;

    const found = new Map<string, {
      player: `0x${string}`;
      tierId: number;
      txHash: string | null;
    }>();

    for (let start = fromBlock; start <= currentBlock; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n < currentBlock
        ? start + LOG_CHUNK - 1n
        : currentBlock;

      let logs: any[] = [];
      try {
        logs = await pub.getLogs({
          address: CLAW_GAME,
          event: GAME_STARTED_EVENT,
          args: { player },
          fromBlock: start,
          toBlock: end,
        });
      } catch {
        logs = await pub.getLogs({
          address: CLAW_GAME,
          event: GAME_STARTED_EVENT,
          fromBlock: start,
          toBlock: end,
        }).catch(() => []);
        logs = logs.filter((log) =>
          String((log.args as any)?.player ?? "").toLowerCase() === player
        );
      }

      for (const log of logs) {
        const args = log.args as any;
        const sessionId = args?.sessionId as bigint | undefined;
        const eventPlayer = args?.player as `0x${string}` | undefined;
        if (!sessionId || eventPlayer?.toLowerCase() !== player) continue;

        found.set(sessionId.toString(), {
          player: eventPlayer,
          tierId: Number(args.tierId ?? 0),
          txHash: log.transactionHash ?? null,
        });
      }
    }

    // If the local index missed a start tx and the log window no longer covers
    // it, recover by walking recent session ids. This is bounded so a single
    // user request cannot scan the whole contract history.
    let idScanned = 0;
    let idRecovered = 0;
    try {
      const unresolved = (await pub.readContract({
        address: CLAW_GAME,
        abi: clawAbi.abi,
        functionName: "unresolvedSessions",
        args: [player],
      })) as bigint;

      if (unresolved > 0n && ID_SCAN_LIMIT > 0) {
        const nextSessionId = (await pub.readContract({
          address: CLAW_GAME,
          abi: clawAbi.abi,
          functionName: "nextSessionId",
        })) as bigint;

        for (
          let sessionId = nextSessionId > 0n ? nextSessionId - 1n : 0n;
          sessionId > 0n && idScanned < ID_SCAN_LIMIT;
          sessionId -= 1n
        ) {
          const sessionIdStr = sessionId.toString();
          if (found.has(sessionIdStr)) continue;
          idScanned += 1;

          const raw = await pub.readContract({
            address: CLAW_GAME,
            abi: clawAbi.abi,
            functionName: "getSession",
            args: [sessionId],
          }).catch(() => null) as any;

          if (!raw) continue;
          const sessionPlayer = String(getSessionField(raw, "player", 1) ?? "").toLowerCase();
          const status = Number(getSessionField(raw, "status", 3));
          if (sessionPlayer !== player) continue;
          if (status !== SS.PENDING && status !== SS.SETTLED) continue;

          found.set(sessionIdStr, {
            player: sessionPlayer as `0x${string}`,
            tierId: Number(getSessionField(raw, "tierId", 2) ?? 0),
            txHash: null,
          });
          idRecovered += 1;
          if (BigInt(idRecovered) >= unresolved) break;
        }
      }
    } catch {
      // Log recovery remains the primary path; id scanning is best effort.
    }

    for (const [sessionId, row] of found) {
      await upsertClawSession({
        sessionId,
        player: row.player,
        tierId: row.tierId,
        txHash: row.txHash,
      });
    }

    const { sessions, error } = await listClawSessionsForPlayer(player, 75);
    if (error) {
      if (isClawSessionsSetupError(error)) {
        return NextResponse.json({
          ok: false,
          setupRequired: true,
          recovered: found.size,
          idScanned,
          idRecovered,
          error: CLAW_SESSIONS_SETUP_MESSAGE,
          sessions: Array.from(found.entries()).map(([sessionId, row]) => ({
            sessionId,
            player: row.player.toLowerCase(),
            tierId: row.tierId,
            txHash: row.txHash,
            createdAt: null,
            updatedAt: null,
          })),
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      recovered: found.size,
      idScanned,
      idRecovered,
      sessions,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
