import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { getOrSyncActiveCycle } from "@/lib/server/crackpotCycleSync";
import {
  THEMES,
  getPotState,
  type CrackPotVersion,
  type CycleView,
} from "@/lib/crackpotTypes";
import { secondsUntil } from "@/lib/server/crackpotEngine";

// Emergency kill switch: set CRACKPOT_PAUSED=true to pause the game.

export async function GET(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  try {
    const url      = new URL(req.url);
    const raw      = url.searchParams.get("version") ?? "miles";
    const version: CrackPotVersion =
      raw === "usdt" ? "usdt" : "miles";

    const cycle = await getOrSyncActiveCycle(version);

    const themeConfig = THEMES[cycle.theme];
    const view: CycleView = {
      cycleId:          cycle.id,
      version:          cycle.version,
      theme:            cycle.theme,
      themeConfig,
      status:           cycle.status,
      potBalance:       cycle.pot_balance,
      potBalanceUsdt:   version === "usdt" ? cycle.pot_balance / 100 : undefined,
      potCap:           cycle.pot_cap,
      potState:         getPotState(cycle.pot_balance, cycle.pot_cap, cycle.status),
      expiresAt:        cycle.expires_at,
      secondsRemaining: secondsUntil(cycle.expires_at),
      winnerAddress:    cycle.winner_address,
      winnerGuesses:    cycle.winner_guesses,
      secretCommitment: cycle.secret_commitment,
    };

    return NextResponse.json(view);
  } catch (err) {
    console.error("[crackpot/cycle/current]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
