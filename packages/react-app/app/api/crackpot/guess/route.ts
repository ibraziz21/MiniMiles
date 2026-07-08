// POST /api/crackpot/guess
//
// Submit a guess for the player's active attempt.
//
// Auth:  requires iron-session.  `player_address` is derived from the session;
//        any client-supplied address field is ignored.  All DB queries include
//        `.eq("player_address", sessionWallet)` so one session cannot read or
//        mutate another player's attempts.
//
// Body: { attemptId: string, symbols: [number, number, number, number] }
//       symbols are 0–5 indices into the active cycle theme's symbol array.
//
// On correct guess:
//   - Attempt status → 'won'.
//   - Cycle status → 'settling' (not 'cracked') — a background worker must
//     call declareWinner() on-chain and decode CycleCracked before the cycle
//     is finalised.  The client is notified via isCorrect + newStatus.
//
// Response: GuessView — feedback without secret_code or secret_salt.
//           Includes `feedbackIsNoiseless: boolean` so the UI can inform players
//           whether feedback is exact (USDT) or probabilistically noisy (Miles).

import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { requireSession } from "@/lib/auth";
import {
  getAttemptForPlayer,
  getGuessesForAttempt,
  getCycleSecret,
  getCycleChainRef,
  submitGuess,
  settleWinningCycle,
} from "@/lib/server/crackpotAttemptHelpers";

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
  const attemptId: string | null =
    typeof body.attemptId === "string" && body.attemptId.length > 0
      ? body.attemptId
      : null;
  const symbols: unknown = body.symbols;

  if (!attemptId) {
    return NextResponse.json({ error: "attemptId_required" }, { status: 400 });
  }
  if (
    !Array.isArray(symbols) ||
    symbols.length !== 4 ||
    symbols.some((s) => typeof s !== "number" || s < 0 || s > 5)
  ) {
    return NextResponse.json(
      { error: "invalid_symbols", message: "symbols must be an array of 4 integers 0–5" },
      { status: 400 },
    );
  }
  const symbolArr = symbols as [number, number, number, number];

  // ── Load attempt — scoped to session wallet ───────────────────────────────
  const attempt = await getAttemptForPlayer(attemptId, playerWallet);
  if (!attempt) {
    // Returns 404 regardless of whether the attempt exists — prevents leaking
    // whether another player's attempt ID is valid.
    return NextResponse.json({ error: "attempt_not_found" }, { status: 404 });
  }

  if (attempt.status !== "active") {
    return NextResponse.json({ error: "attempt_not_active", status: attempt.status }, { status: 409 });
  }
  if (new Date(attempt.expires_at) < new Date()) {
    // Mark expired in DB (fire-and-forget — next request will also see it).
    void import("@/lib/supabaseClient").then(({ supabase }) =>
      supabase
        .from("crackpot_attempts")
        .update({ status: "expired" })
        .eq("id", attempt.id)
        .eq("player_address", playerWallet),
    );
    return NextResponse.json({ error: "attempt_expired" }, { status: 410 });
  }

  // ── Load cycle secret (server-only — never returned to client) ────────────
  const cycleData = await getCycleSecret(attempt.cycle_id);
  if (!cycleData) {
    return NextResponse.json({ error: "cycle_not_found" }, { status: 500 });
  }

  // ── Count existing guesses for this attempt ───────────────────────────────
  const existingGuesses = await getGuessesForAttempt(attempt.id, playerWallet);
  const guessNumber     = existingGuesses.length + 1;

  // ── Submit guess ──────────────────────────────────────────────────────────
  const result = await submitGuess(
    {
      attemptId:    attempt.id,
      cycleId:      attempt.cycle_id,
      playerWallet,
      guessNumber,
      symbols:      symbolArr,
      secret:       cycleData.secret,
      version:      cycleData.version, // governs noise policy
    },
    attempt,
    cycleData.theme,
  );

  // ── Settlement: enqueue payout job if correct ─────────────────────────────
  // The cycle is NOT marked 'cracked' here.  The worker calls declareWinner()
  // on-chain, decodes CycleCracked, then finalises the cycle to 'cracked'.
  if (result.isCorrect) {
    const cycleRef = await getCycleChainRef(attempt.cycle_id);
    if (cycleRef) {
      const enqueued = await settleWinningCycle(cycleRef, playerWallet, guessNumber);
      if (!enqueued) {
        return NextResponse.json({ error: "settlement_not_enqueued" }, { status: 500 });
      }
    } else {
      console.error("[guess/route] getCycleChainRef returned null for cycle", attempt.cycle_id);
      return NextResponse.json({ error: "settlement_not_enqueued" }, { status: 500 });
    }
  }

  // ── Response — no secret_code, no secret_salt ─────────────────────────────
  // feedbackIsNoiseless tells the UI whether it can treat feedback as exact.
  const feedbackIsNoiseless = cycleData.version === "usdt" || cycleData.version === "base_usdc";

  return NextResponse.json({
    guessView:          result.guessView,
    isCorrect:          result.isCorrect,
    newStatus:          result.newStatus,
    guessNumber,
    feedbackIsNoiseless,
  });
}
