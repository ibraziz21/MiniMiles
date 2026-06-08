// POST /api/crackpot/attempt/upsell
// Unlock 3 more attempts after the 3 free ones are used.
//
// Payment goes through the same on-chain enterGame() call as a regular entry —
// the client submits the tx and passes the txHash here. The server verifies
// EntryRecorded was emitted for this player and grants UPSELL_ATTEMPTS_PER_PURCHASE
// paid attempts.
//
// This keeps the USDT flow consistent: all payments go to the contract, not
// via a separate relayer-pull path.

import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabaseClient";
import {
  type CrackPotCycle,
  type CrackPotAttempt,
  FREE_ATTEMPTS_PER_CYCLE,
  UPSELL_ATTEMPTS_PER_PURCHASE,
} from "@/lib/crackpotTypes";
import { buildAttemptExpiresAt, secondsUntil } from "@/lib/server/crackpotEngine";

const CRACKPOT_ADDRESS = (
  process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? ""
).toLowerCase() as `0x${string}`;

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const ENTRY_RECORDED_EVENT = parseAbiItem(
  "event EntryRecorded(uint256 indexed cycleId, address indexed player, uint256 entryAmount, uint256 newPotBalance)",
);

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

    // ── Verify on-chain entry tx ──────────────────────────────────
    const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    }).catch(() => null);

    if (!receipt || receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction not confirmed or failed" }, { status: 402 });
    }

    const entryLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== CRACKPOT_ADDRESS) return false;
      try {
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

    // ── Guard: free attempts must be exhausted ────────────────────
    const { data: attempts } = await supabase
      .from("crackpot_attempts")
      .select("id, is_paid, status, expires_at")
      .eq("cycle_id", c.id)
      .eq("player_address", playerAddress);

    const allAttempts = (attempts ?? []) as CrackPotAttempt[];
    const freeUsed = allAttempts.filter((a) => !a.is_paid).length;

    if (freeUsed < FREE_ATTEMPTS_PER_CYCLE) {
      return NextResponse.json({ error: "You still have free attempts remaining" }, { status: 400 });
    }

    // Prevent replaying the same txHash for multiple upsell packs
    const { data: existing } = await supabase
      .from("crackpot_attempts")
      .select("id")
      .eq("cycle_id", c.id)
      .eq("player_address", playerAddress)
      .eq("entry_tx_hash", txHash)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "This transaction has already been used for an upsell" }, { status: 409 });
    }

    // ── Sync pot balance from tx event ────────────────────────────
    try {
      const isUsdt = version === "usdt";
      const data = entryLog.data;
      const newPotBalanceRaw = BigInt("0x" + data.slice(66));
      const newPotBalance = isUsdt
        ? Number(newPotBalanceRaw / 100n)
        : Number(newPotBalanceRaw / BigInt(1e18));
      await supabase
        .from("crackpot_cycles")
        .update({ pot_balance: newPotBalance })
        .eq("id", c.id);
    } catch {
      // Non-fatal
    }

    // ── Grant UPSELL_ATTEMPTS_PER_PURCHASE paid attempts ──────────
    const now = new Date();
    const expiresAt = buildAttemptExpiresAt(now);
    const baseNumber = allAttempts.length + 1;

    const insertRows = Array.from({ length: UPSELL_ATTEMPTS_PER_PURCHASE }, (_, i) => ({
      cycle_id:        c.id,
      player_address:  playerAddress,
      attempt_number:  baseNumber + i,
      started_at:      now.toISOString(),
      expires_at:      expiresAt.toISOString(),
      status:          "active",
      guesses_used:    0,
      is_paid:         true,
      entry_tx_hash:   txHash,
    }));

    // Only insert the first as active; rest will activate when the player starts them
    const firstRow = { ...insertRows[0] };
    const remainingRows = insertRows.slice(1).map((r) => ({ ...r, status: "queued" }));

    const { error: insertErr } = await supabase
      .from("crackpot_attempts")
      .insert([firstRow, ...remainingRows]);

    if (insertErr) {
      console.error("[crackpot/attempt/upsell] insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create upsell attempts" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      attemptsUnlocked: UPSELL_ATTEMPTS_PER_PURCHASE,
      attemptId: firstRow.cycle_id,
      expiresAt: expiresAt.toISOString(),
      secondsRemaining: secondsUntil(expiresAt.toISOString()),
    });
  } catch (err: any) {
    console.error("[crackpot/attempt/upsell]", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
