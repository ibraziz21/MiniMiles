// POST /api/crackpot/attempt/start
// Flow: player calls enterGame() on-chain first (burns Miles / pulls USDT).
// Client sends the tx hash. Server verifies the tx is confirmed and the
// EntryRecorded event was emitted for this player, then opens a 2-min attempt.

import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabaseClient";
import {
  type CrackPotCycle,
  type CrackPotAttempt,
  FREE_ATTEMPTS_PER_CYCLE,
} from "@/lib/crackpotTypes";
import {
  buildAttemptExpiresAt,
  isAttemptExpired,
  secondsUntil,
} from "@/lib/server/crackpotEngine";

const CRACKPOT_ADDRESS = (
  process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? ""
).toLowerCase() as `0x${string}`;

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const ENTRY_RECORDED_EVENT = parseAbiItem(
  "event EntryRecorded(uint256 indexed cycleId, address indexed player, uint256 entryAmount, uint256 newPotBalance)",
);

function getPublicClient() {
  return createPublicClient({ chain: celo, transport: http(CELO_RPC) });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, version = "miles", txHash } = body as {
      address: string;
      version?: string;
      txHash: string;
    };

    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }
    if (!txHash || typeof txHash !== "string") {
      return NextResponse.json({ error: "txHash required — call enterGame() on-chain first" }, { status: 400 });
    }
    if (version !== "miles" && version !== "usdt") {
      return NextResponse.json({ error: "invalid version" }, { status: 400 });
    }

    const playerAddress = address.toLowerCase() as `0x${string}`;
    const isUsdt = version === "usdt";

    // ── Verify on-chain tx ────────────────────────────────────────
    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    }).catch(() => null);

    if (!receipt || receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction not confirmed or failed" }, { status: 402 });
    }

    // Confirm EntryRecorded was emitted for this player from the CrackPot contract
    const entryLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== CRACKPOT_ADDRESS) return false;
      try {
        // topic[0] = event sig, topic[2] = indexed player
        const playerTopic = `0x000000000000000000000000${playerAddress.replace("0x", "")}`;
        return log.topics[2]?.toLowerCase() === playerTopic.toLowerCase();
      } catch { return false; }
    });

    if (!entryLog) {
      return NextResponse.json(
        { error: "EntryRecorded event not found for this player in the tx" },
        { status: 402 },
      );
    }

    // ── Load active cycle ─────────────────────────────────────────
    const { data: cycle } = await supabase
      .from("crackpot_cycles")
      .select("*")
      .eq("status", "active")
      .eq("version", version)
      .maybeSingle();

    if (!cycle) return NextResponse.json({ error: "No active cycle" }, { status: 404 });
    const c = cycle as CrackPotCycle;

    if (new Date(c.expires_at) < new Date()) {
      return NextResponse.json({ error: "Cycle has expired" }, { status: 409 });
    }

    // ── Guard: no concurrent active attempt, free limit ──────────
    const { data: attempts } = await supabase
      .from("crackpot_attempts")
      .select("*")
      .eq("cycle_id", c.id)
      .eq("player_address", playerAddress);

    const allAttempts = (attempts ?? []) as CrackPotAttempt[];

    const active = allAttempts.find(
      (a) => a.status === "active" && !isAttemptExpired(a.expires_at),
    );
    if (active) {
      return NextResponse.json(
        { error: "You already have an active attempt", attemptId: active.id, secondsRemaining: secondsUntil(active.expires_at) },
        { status: 409 },
      );
    }

    const freeUsed = allAttempts.filter((a) => !a.is_paid).length;
    if (freeUsed >= FREE_ATTEMPTS_PER_CYCLE) {
      return NextResponse.json(
        { error: "Free attempts exhausted. Use /attempt/upsell to unlock more." },
        { status: 402 },
      );
    }

    // ── Sync pot balance from tx event ────────────────────────────
    // The contract already updated the pot on-chain — sync Supabase to match.
    try {
      // newPotBalance is the last non-indexed param in the event
      // topics: [sig, cycleId, player] — data contains entryAmount + newPotBalance
      const data = entryLog.data; // 64 hex chars = 2 x uint256
      const newPotBalanceRaw = BigInt("0x" + data.slice(66)); // second uint256
      // Miles: raw 18-dec → integer miles; USDT: raw 6-dec → cents
      const newPotBalance = isUsdt
        ? Number(newPotBalanceRaw / 100n)       // cents
        : Number(newPotBalanceRaw / BigInt(1e18)); // miles
      await supabase
        .from("crackpot_cycles")
        .update({ pot_balance: newPotBalance })
        .eq("id", c.id);
    } catch {
      // Non-fatal — pot display may lag one poll cycle
    }

    // ── Create attempt ────────────────────────────────────────────
    const now = new Date();
    const expiresAt = buildAttemptExpiresAt(now);
    const attemptNumber = allAttempts.length + 1;

    const { data: attempt, error: insertErr } = await supabase
      .from("crackpot_attempts")
      .insert({
        cycle_id: c.id,
        player_address: playerAddress,
        attempt_number: attemptNumber,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        status: "active",
        guesses_used: 0,
        is_paid: false,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[crackpot/attempt/start] insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create attempt" }, { status: 500 });
    }

    const a = attempt as CrackPotAttempt;
    return NextResponse.json({
      attemptId: a.id,
      attemptNumber: a.attempt_number,
      expiresAt: a.expires_at,
      secondsRemaining: secondsUntil(a.expires_at),
      freeAttemptsUsed: freeUsed + 1,
    });
  } catch (err: any) {
    console.error("[crackpot/attempt/start]", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
