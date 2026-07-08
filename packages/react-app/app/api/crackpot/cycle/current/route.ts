import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { getOrSyncActiveCycle } from "@/lib/server/crackpotCycleSync";
import { supabase } from "@/lib/supabaseClient";
import {
  THEMES,
  getPotState,
  type CrackPotVersion,
  type CycleView,
} from "@/lib/crackpotTypes";
import { secondsUntil } from "@/lib/server/crackpotEngine";

// Emergency kill switch: set CRACKPOT_PAUSED=true to pause the game.

function buildCycleView(cycle: any, version: CrackPotVersion): CycleView {
  const themeConfig = THEMES[cycle.theme as keyof typeof THEMES];
  return {
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
}

async function getFallbackDbCycle(version: CrackPotVersion): Promise<CycleView | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select(
      "id, version, theme, status, pot_balance, pot_cap, seed_amount, " +
      "expires_at, winner_address, winner_guesses, created_at, secret_commitment",
    )
    .eq("version", version)
    .in("status", ["active", "settling"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return buildCycleView(data, version);
}

export async function GET(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  const url      = new URL(req.url);
  const raw      = url.searchParams.get("version") ?? "miles";
  const version: CrackPotVersion =
    raw === "usdt" ? "usdt" : "miles";

  try {
    const cycle = await getOrSyncActiveCycle(version);
    return NextResponse.json(buildCycleView(cycle, version));
  } catch (err) {
    console.error("[crackpot/cycle/current]", err);
    const fallback = await getFallbackDbCycle(version);
    if (fallback) {
      return NextResponse.json(fallback, {
        headers: { "x-crackpot-sync": "fallback" },
      });
    }
    return NextResponse.json(
      {
        error: "cycle_unavailable",
        message: "CrackPot cycle is rotating. Retry in a moment.",
      },
      { status: 503 },
    );
  }
}
