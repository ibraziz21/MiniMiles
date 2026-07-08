// POST /api/crackpot/attempt/start
//
// Starts a new CrackPot attempt session.
//
// Auth:   requires iron-session.  Player wallet is derived from the session;
//         any client-supplied `address` field in the body is ignored.
//
// USDT flow:
//   1. Require txHash in body.
//   2. Idempotency check — if this tx already has an attempt, return it.
//   3. Verify the receipt: success, correct contract, EntryRecorded event,
//      player = session wallet, cycleId = active chain cycle.
//   4. Insert attempt row with chain_id / entry_tx_hash / entry_log_index.
//
// MILES flow (free):
//   1. No txHash required.
//   2. Check player hasn't exceeded FREE_ATTEMPTS_PER_CYCLE.
//   3. Create attempt row.

import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { crackPotComingSoonResponse } from "@/lib/server/crackpotComingSoon";
import { requireSession } from "@/lib/auth";
import { getOrSyncActiveCycle } from "@/lib/server/crackpotCycleSync";
import { verifyUsdtEntry }      from "@/lib/server/crackpotEntryVerifier";
import {
  findAttemptByTxHash,
  getActiveAttemptForPlayer,
  countAttemptsForPlayer,
  createAttempt,
  getGuessesForAttempt,
  buildAttemptView,
  getCycleSecret,
} from "@/lib/server/crackpotAttemptHelpers";
import { FREE_ATTEMPTS_PER_CYCLE } from "@/lib/crackpotTypes";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

const CRACKPOT_LIVE  = process.env.CRACKPOT_LIVE === "true";
const CELO_CHAIN_ID  = celo.id;                       // 42220
const HASH_RE        = /^0x[0-9a-fA-F]{64}$/;

export async function POST(req: Request) {
  if (!CRACKPOT_LIVE) return crackPotComingSoonResponse();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const appSession = await requireSession();
  if (!appSession) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  const playerWallet = appSession.walletAddress.toLowerCase();

  // ── Parse body ────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const rawVersion = typeof body.version === "string" ? body.version : "miles";
  const version: CrackPotVersion = rawVersion === "usdt" ? "usdt" : "miles";
  const txHash: string | null =
    typeof body.txHash === "string" && HASH_RE.test(body.txHash.trim())
      ? body.txHash.trim().toLowerCase()
      : null;

  if (version === "usdt" && !txHash) {
    return NextResponse.json(
      { error: "tx_hash_required", message: "txHash is required for USDT attempts" },
      { status: 400 },
    );
  }

  // ── Get chain-backed active cycle ─────────────────────────────────────────
  const activeCycle = await getOrSyncActiveCycle(version as "miles" | "usdt");

  // ── USDT path ─────────────────────────────────────────────────────────────
  if (version === "usdt") {
    // Idempotency: if this tx already created an attempt, return it.
    const existing = await findAttemptByTxHash(CELO_CHAIN_ID, txHash!);
    if (existing) {
      if (existing.player_address !== playerWallet) {
        return NextResponse.json({ error: "tx_belongs_to_another_player" }, { status: 403 });
      }
      const guesses = await getGuessesForAttempt(existing.id, playerWallet);
      const cycleData = await getCycleSecret(existing.cycle_id);
      const { total, free } = await countAttemptsForPlayer(existing.cycle_id, playerWallet);
      return NextResponse.json(
        buildAttemptView(existing, guesses, cycleData?.theme ?? "bank-vault", free, total),
      );
    }

    // Verify the tx.
    const verified = await verifyUsdtEntry(txHash!, playerWallet, activeCycle, CELO_CHAIN_ID);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.reason }, { status: 422 });
    }

    // Ensure cycle has chain fields (defensive — getOrSyncActiveCycle guarantees this).
    if (!activeCycle.contract_cycle_id) {
      return NextResponse.json({ error: "cycle_not_chain_anchored" }, { status: 500 });
    }

    const { total } = await countAttemptsForPlayer(activeCycle.id, playerWallet);
    const attempt = await createAttempt({
      cycleId:       activeCycle.id,
      playerWallet,
      attemptNumber: total + 1,
      isPaid:        true,
      chainId:       CELO_CHAIN_ID,
      txHash,
      logIndex:      verified.logIndex,
    });

    const guesses     = await getGuessesForAttempt(attempt.id, playerWallet);
    const cycleData   = await getCycleSecret(attempt.cycle_id);
    const counts      = await countAttemptsForPlayer(activeCycle.id, playerWallet);
    return NextResponse.json(
      buildAttemptView(attempt, guesses, cycleData?.theme ?? "bank-vault", counts.free, counts.total),
    );
  }

  // ── MILES path (free attempts) ────────────────────────────────────────────
  // Return active unexpired attempt if one already exists.
  const activeAttempt = await getActiveAttemptForPlayer(activeCycle.id, playerWallet);
  if (activeAttempt) {
    const guesses = await getGuessesForAttempt(activeAttempt.id, playerWallet);
    const cycleData = await getCycleSecret(activeAttempt.cycle_id);
    const counts  = await countAttemptsForPlayer(activeCycle.id, playerWallet);
    return NextResponse.json(
      buildAttemptView(activeAttempt, guesses, cycleData?.theme ?? "bank-vault", counts.free, counts.total),
    );
  }

  const { total, free } = await countAttemptsForPlayer(activeCycle.id, playerWallet);
  if (free >= FREE_ATTEMPTS_PER_CYCLE) {
    return NextResponse.json(
      { error: "free_attempts_exhausted", canUpsell: true },
      { status: 402 },
    );
  }

  const attempt = await createAttempt({
    cycleId:       activeCycle.id,
    playerWallet,
    attemptNumber: total + 1,
    isPaid:        false,
    chainId:       null,
    txHash:        null,
    logIndex:      null,
  });

  const guesses   = await getGuessesForAttempt(attempt.id, playerWallet);
  const cycleData = await getCycleSecret(attempt.cycle_id);
  const counts    = await countAttemptsForPlayer(activeCycle.id, playerWallet);
  return NextResponse.json(
    buildAttemptView(attempt, guesses, cycleData?.theme ?? "bank-vault", counts.free, counts.total),
  );
}
