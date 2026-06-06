// GET /api/crackpot/cycle/current
// Returns the active cycle view (no secret code) + requesting player state.
// ?address=0x...&version=miles|usdt
// Creates a new cycle for that version if none is active.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { contractOpenCycle, ContractVersion } from "@/lib/server/crackpotContract";
import {
  type CrackPotCycle,
  type CrackPotAttempt,
  type CrackPotGuess,
  type CycleView,
  type PlayerCycleState,
  type AttemptView,
  type GuessView,
  type CrackPotVersion,
  THEMES,
  getPotState,
  FREE_ATTEMPTS_PER_CYCLE,
} from "@/lib/crackpotTypes";
import {
  buildNewCycle,
  secondsUntil,
  isAttemptExpired,
} from "@/lib/server/crackpotEngine";

async function fetchOrCreateCycle(version: CrackPotVersion): Promise<CrackPotCycle> {
  const { data: existing } = await supabase
    .from("crackpot_cycles")
    .select("*")
    .eq("status", "active")
    .eq("version", version)
    .maybeSingle();

  if (existing) return existing as CrackPotCycle;

  const entropyRes = await fetch("https://blockchain.info/q/latesthash").catch(() => null);
  const entropy = entropyRes?.ok ? await entropyRes.text() : `fallback-${Date.now()}`;

  const newCycle = buildNewCycle(entropy.trim(), version);
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .insert(newCycle)
    .select()
    .single();

  if (error) {
    console.error("[crackpot] insert error full:", JSON.stringify(error));
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("crackpot_cycles")
        .select("*")
        .eq("status", "active")
        .eq("version", version)
        .maybeSingle();
      if (raced) return raced as CrackPotCycle;
    }
    throw new Error(`Failed to create cycle: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  }

  // Open cycle on-chain — fire-and-forget, non-blocking
  const contractVer = version === "usdt" ? ContractVersion.USDT : ContractVersion.MILES;
  contractOpenCycle(contractVer, new Date(newCycle.expires_at))
    .catch((e) => console.error("[crackpot/current] contractOpenCycle failed:", e?.message));

  return data as CrackPotCycle;
}

async function getPlayerState(
  cycle: CrackPotCycle,
  playerAddress: string,
): Promise<PlayerCycleState> {
  const addr = playerAddress.toLowerCase();

  const { data: attempts } = await supabase
    .from("crackpot_attempts")
    .select("*")
    .eq("cycle_id", cycle.id)
    .eq("player_address", addr)
    .order("attempt_number", { ascending: true });

  const allAttempts = (attempts ?? []) as CrackPotAttempt[];
  const totalAttemptsUsed = allAttempts.length;
  const freeAttemptsUsed = allAttempts.filter((a) => !a.is_paid).length;
  const hasWonThisCycle = allAttempts.some((a) => a.status === "won");

  const activeAttempt = allAttempts.find(
    (a) => a.status === "active" && !isAttemptExpired(a.expires_at),
  ) ?? null;

  let activeAttemptView: AttemptView | null = null;
  let bestGuessCount: number | null = null;

  if (activeAttempt) {
    const { data: guesses } = await supabase
      .from("crackpot_guesses")
      .select("*")
      .eq("attempt_id", activeAttempt.id)
      .order("guess_number", { ascending: true });

    const guessRows = (guesses ?? []) as CrackPotGuess[];
    const theme = THEMES[cycle.theme as keyof typeof THEMES];

    const guessViews: GuessView[] = guessRows.map((g) => ({
      guessNumber: g.guess_number,
      symbols: g.symbols as [number, number, number, number],
      symbolLabels: (g.symbols as number[]).map((i) => theme.symbolLabels[i]) as [string, string, string, string],
      feedback: g.feedback as any,
      isCorrect: g.is_correct,
      createdAt: g.created_at,
    }));

    if (guessRows.length > 0) {
      bestGuessCount = Math.max(...guessRows.map((g) => g.locked_count));
    }

    activeAttemptView = {
      attemptId: activeAttempt.id,
      attemptNumber: activeAttempt.attempt_number,
      expiresAt: activeAttempt.expires_at,
      secondsRemaining: secondsUntil(activeAttempt.expires_at),
      guessesUsed: activeAttempt.guesses_used,
      status: activeAttempt.status,
      guesses: guessViews,
      freeAttemptsUsed,
      totalAttemptsUsed,
      canUpsell: !hasWonThisCycle && freeAttemptsUsed >= FREE_ATTEMPTS_PER_CYCLE,
    };
  } else if (allAttempts.length > 0) {
    const { data: allGuesses } = await supabase
      .from("crackpot_guesses")
      .select("locked_count")
      .eq("cycle_id", cycle.id)
      .eq("player_address", addr);
    if (allGuesses && allGuesses.length > 0) {
      bestGuessCount = Math.max(...allGuesses.map((g) => g.locked_count as number));
    }
  }

  return {
    hasActiveAttempt: !!activeAttemptView,
    activeAttempt: activeAttemptView,
    freeAttemptsUsed,
    totalAttemptsUsed,
    hasWonThisCycle,
    bestGuessCount,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const playerAddress = url.searchParams.get("address")?.toLowerCase() ?? null;
    const version = (url.searchParams.get("version") ?? "miles") as CrackPotVersion;

    if (version !== "miles" && version !== "usdt") {
      return NextResponse.json({ error: "Invalid version" }, { status: 400 });
    }

    const cycle = await fetchOrCreateCycle(version);
    const theme = THEMES[cycle.theme as keyof typeof THEMES];
    const isUsdt = cycle.version === "usdt";

    const cycleView: CycleView = {
      cycleId: cycle.id,
      version: cycle.version,
      theme: cycle.theme as any,
      themeConfig: theme,
      status: cycle.status as any,
      potBalance: cycle.pot_balance,
      potBalanceUsdt: isUsdt ? cycle.pot_balance / 100 : undefined,
      potCap: cycle.pot_cap,
      potState: getPotState(cycle.pot_balance, cycle.pot_cap, cycle.status as any),
      expiresAt: cycle.expires_at,
      secondsRemaining: secondsUntil(cycle.expires_at),
      winnerAddress: cycle.winner_address,
      winnerGuesses: cycle.winner_guesses,
    };

    let playerState: PlayerCycleState | null = null;
    if (playerAddress) {
      playerState = await getPlayerState(cycle, playerAddress);
    }

    return NextResponse.json({ cycle: cycleView, player: playerState });
  } catch (err: any) {
    console.error("[crackpot/cycle/current]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
