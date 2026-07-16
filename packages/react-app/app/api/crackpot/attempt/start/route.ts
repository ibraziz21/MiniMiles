// POST /api/crackpot/attempt/start
//
// Starts a new CrackPot attempt session.
//
// Auth:   requires iron-session.  Player wallet is derived from the session;
//         any client-supplied `address` field in the body is ignored.
//
// Paid entry flow:
//   1. Require txHash in body.
//   2. Idempotency check — if this tx already has an attempt, return it.
//   3. Verify the receipt: success, correct contract, EntryRecorded event,
//      player = session wallet, version, cycleId = active chain cycle.
//   4. Insert attempt row with chain_id / entry_tx_hash / entry_log_index.

import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { requireSession } from "@/lib/auth";
import { getOrSyncActiveCycle, CycleRotatingError } from "@/lib/server/crackpotCycleSync";
import { verifyCrackPotEntry } from "@/lib/server/crackpotEntryVerifier";
import {
  findAttemptByTxHash,
  countAttemptsForPlayer,
  createAttempt,
  getGuessesForAttempt,
  getGuessesForCycle,
  buildAttemptView,
  getCycleSecret,
} from "@/lib/server/crackpotAttemptHelpers";
import { recordOrphanedEntry } from "@/lib/server/crackpotOrphanedEntries";
import { secondsUntil } from "@/lib/server/crackpotEngine";
import {
  MIN_PLAYABLE_WINDOW_SECONDS,
  MAX_ATTEMPTS_PER_CYCLE,
  type CrackPotVersion,
} from "@/lib/crackpotTypes";

const CELO_CHAIN_ID  = celo.id;                       // 42220
const HASH_RE        = /^0x[0-9a-fA-F]{64}$/;
type PlayVersion = Extract<CrackPotVersion, "miles" | "usdt">;

export async function POST(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const appSession = await requireSession();
  if (!appSession) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  const playerWallet = appSession.walletAddress.toLowerCase();

  // ── Parse body ────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const rawVersion = typeof body.version === "string" ? body.version : "miles";
  const version: PlayVersion = rawVersion === "usdt" ? "usdt" : "miles";

  if (!isCrackPotLive(version)) return crackPotComingSoonResponse(version);

  const txHash: string | null =
    typeof body.txHash === "string" && HASH_RE.test(body.txHash.trim())
      ? body.txHash.trim().toLowerCase()
      : null;

  if (!txHash) {
    return NextResponse.json(
      { error: "tx_hash_required", message: "A paid CrackPot entry transaction is required" },
      { status: 400 },
    );
  }

  // Idempotency: if this tx already created an attempt, return it.
  const existing = await findAttemptByTxHash(CELO_CHAIN_ID, txHash);
  if (existing) {
    if (existing.player_address !== playerWallet) {
      return NextResponse.json({ error: "tx_belongs_to_another_player" }, { status: 403 });
    }
    const guesses = await getGuessesForAttempt(existing.id, playerWallet);
    const cycleGuesses = await getGuessesForCycle(existing.cycle_id, playerWallet);
    const priorGuesses = cycleGuesses.filter((g) => g.attempt_id !== existing.id);
    const cycleData = await getCycleSecret(existing.cycle_id);
    const { total, free } = await countAttemptsForPlayer(existing.cycle_id, playerWallet);
    return NextResponse.json(
      buildAttemptView(existing, guesses, cycleData?.theme ?? "bank-vault", free, total, priorGuesses),
    );
  }

  // ── Get chain-backed active cycle ─────────────────────────────────────────
  let activeCycle;
  try {
    activeCycle = await getOrSyncActiveCycle(version as "miles" | "usdt");
  } catch (err) {
    if (err instanceof CycleRotatingError) {
      return NextResponse.json(
        {
          error: "cycle_rotating",
          message: "A new CrackPot round is opening. Your paid entry is safe — retry in a moment.",
          retryAfterSeconds: err.retryAfterSeconds,
        },
        {
          status: 503,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }
    throw err;
  }

  // Verify the tx.
  const verified = await verifyCrackPotEntry(txHash, playerWallet, activeCycle, CELO_CHAIN_ID, version);
  if (!verified.ok) {
    // The entry landed in an EARLIER cycle — the round rotated between the
    // payment tx and this call. The fee is real; log it for credit/refund
    // instead of silently rejecting.
    if (
      verified.reason === "cycle_mismatch" &&
      verified.txCycleId != null &&
      activeCycle.contract_cycle_id != null &&
      Number(verified.txCycleId) < activeCycle.contract_cycle_id
    ) {
      await recordOrphanedEntry({
        chainId:         CELO_CHAIN_ID,
        txHash,
        logIndex:        verified.logIndex ?? null,
        playerAddress:   playerWallet,
        version,
        contractCycleId: Number(verified.txCycleId),
        entryAmount:     verified.entryAmount?.toString() ?? null,
        reason:          "cycle_rotated",
      });
      return NextResponse.json(
        {
          error: "entry_cycle_rotated",
          message:
            "The round ended before your entry was confirmed. Your payment has been logged for a credit — you have not lost it.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: verified.reason }, { status: 422 });
  }

  // Ensure cycle has chain fields (defensive — getOrSyncActiveCycle guarantees this).
  if (!activeCycle.contract_cycle_id) {
    return NextResponse.json({ error: "cycle_not_chain_anchored" }, { status: 500 });
  }

  // Too little time left to play even one guess — log the paid entry for
  // credit rather than opening an attempt that expires instantly.
  const cycleSecondsLeft = secondsUntil(activeCycle.expires_at);
  if (cycleSecondsLeft < MIN_PLAYABLE_WINDOW_SECONDS) {
    await recordOrphanedEntry({
      chainId:         CELO_CHAIN_ID,
      txHash,
      logIndex:        verified.logIndex,
      playerAddress:   playerWallet,
      version,
      contractCycleId: activeCycle.contract_cycle_id,
      entryAmount:     verified.entryAmount.toString(),
      reason:          "entry_too_late",
    });
    return NextResponse.json(
      {
        error: "entry_too_late",
        message:
          "This round is ending in seconds — too late to play your entry. Your payment has been logged for a credit.",
      },
      { status: 409 },
    );
  }

  const { total } = await countAttemptsForPlayer(activeCycle.id, playerWallet);

  // Anti-solver: cap paid entries per player per cycle. The fee already
  // landed on-chain, so log it for credit/refund rather than discarding it.
  if (total >= MAX_ATTEMPTS_PER_CYCLE) {
    await recordOrphanedEntry({
      chainId:         CELO_CHAIN_ID,
      txHash,
      logIndex:        verified.logIndex,
      playerAddress:   playerWallet,
      version,
      contractCycleId: activeCycle.contract_cycle_id,
      entryAmount:     verified.entryAmount.toString(),
      reason:          "attempt_limit_reached",
    });
    return NextResponse.json(
      {
        error: "attempt_limit_reached",
        message:
          `You've used all ${MAX_ATTEMPTS_PER_CYCLE} entries for this round. Your payment has been logged for a credit.`,
      },
      { status: 409 },
    );
  }

  const attempt = await createAttempt({
    cycleId:       activeCycle.id,
    playerWallet,
    attemptNumber: total + 1,
    isPaid:        true,
    chainId:       CELO_CHAIN_ID,
    txHash,
    logIndex:      verified.logIndex,
    // Never let the attempt window outlive the cycle itself.
    maxExpiresAt:  new Date(activeCycle.expires_at),
  });

  const guesses      = await getGuessesForAttempt(attempt.id, playerWallet);
  const cycleGuesses = await getGuessesForCycle(activeCycle.id, playerWallet);
  const priorGuesses = cycleGuesses.filter((g) => g.attempt_id !== attempt.id);
  const cycleData    = await getCycleSecret(attempt.cycle_id);
  const counts       = await countAttemptsForPlayer(activeCycle.id, playerWallet);
  return NextResponse.json(
    buildAttemptView(attempt, guesses, cycleData?.theme ?? "bank-vault", counts.free, counts.total, priorGuesses),
  );
}
