// GET /api/crackpot/attempt/current?version=miles|usdt
//
// Restores the player's in-progress state after a refresh. Returns the active
// (non-expired) attempt for the current cycle, plus the player's prior guesses
// this cycle. Returns { attempt: null } when there is nothing to restore.
//
// Deliberately DB-only: restore runs on every page load and must stay fast
// and available even while the chain-backed cycle sync is rotating. The
// chain sync is triggered by /api/crackpot/cycle/current on the same load.
//
// Auth: requires iron-session. Player wallet is derived from the session.

import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { requireSession } from "@/lib/auth";
import {
  findLiveDbCycle,
  getActiveAttemptForPlayer,
  getGuessesForAttempt,
  getGuessesForCycle,
  countAttemptsForPlayer,
  buildAttemptView,
  getCycleSecret,
} from "@/lib/server/crackpotAttemptHelpers";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

type PlayVersion = Extract<CrackPotVersion, "miles" | "usdt">;

export async function GET(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  const appSession = await requireSession();
  if (!appSession) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  const playerWallet = appSession.walletAddress.toLowerCase();

  const url = new URL(req.url);
  const rawVersion = url.searchParams.get("version") ?? "miles";
  const version: PlayVersion = rawVersion === "usdt" ? "usdt" : "miles";

  const activeCycle = await findLiveDbCycle(version);
  if (!activeCycle) {
    // No live cycle in the DB (rotating or first boot) — attempts are clamped
    // to their cycle's end, so there is nothing valid to restore.
    return NextResponse.json({ attempt: null });
  }

  const activeAttempt = await getActiveAttemptForPlayer(activeCycle.id, playerWallet);
  if (!activeAttempt) {
    return NextResponse.json({ attempt: null });
  }

  const guesses      = await getGuessesForAttempt(activeAttempt.id, playerWallet);
  const cycleGuesses = await getGuessesForCycle(activeCycle.id, playerWallet);
  const priorGuesses = cycleGuesses.filter((g) => g.attempt_id !== activeAttempt.id);
  const cycleData    = await getCycleSecret(activeCycle.id);
  const counts       = await countAttemptsForPlayer(activeCycle.id, playerWallet);

  return NextResponse.json({
    attempt: buildAttemptView(
      activeAttempt,
      guesses,
      cycleData?.theme ?? "bank-vault",
      counts.free,
      counts.total,
      priorGuesses,
    ),
  });
}
