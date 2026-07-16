import { NextResponse } from "next/server";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { getOrSyncActiveCycle, CycleRotatingError } from "@/lib/server/crackpotCycleSync";
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
  const url      = new URL(req.url);
  const raw      = url.searchParams.get("version") ?? "miles";
  const version: CrackPotVersion =
    raw === "usdt" ? "usdt" : "miles";

  if (!isCrackPotLive(version)) return crackPotComingSoonResponse(version);

  try {
    const cycle = await getOrSyncActiveCycle(version);
    return NextResponse.json(buildCycleView(cycle, version));
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    // Orphaned chain cycle — on-chain commitment exists but the DB preimage is gone.
    // Cannot safely reconstruct the secret; treat this version as temporarily unavailable
    // until the cycle expires naturally and the server opens a fresh one.
    if (msg.includes("no DB preimage")) {
      console.warn(`[crackpot/cycle/current] orphaned ${version} cycle — returning maintenance response`);
      return crackPotComingSoonResponse();
    }
    if (!(err instanceof CycleRotatingError)) {
      console.error("[crackpot/cycle/current]", err);
    }
    const fallback = await getFallbackDbCycle(version);
    if (fallback) {
      return NextResponse.json(fallback, {
        headers: { "x-crackpot-sync": "fallback" },
      });
    }
    if (err instanceof CycleRotatingError) {
      // Not an error from the client's perspective: the round is rotating.
      // 200 + status:"rotating" so the UI shows a "new round opening" state
      // and keeps polling instead of an error screen.
      return NextResponse.json({
        status:            "rotating",
        version,
        retryAfterSeconds: err.retryAfterSeconds,
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
