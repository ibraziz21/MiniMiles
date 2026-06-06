// POST /api/crackpot/guess
// Submit a 4-symbol guess. Returns noisy feedback. Handles win condition.
// Version A win: mint Miles to player.
// Version B win: transfer USDT from treasury to player.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { contractDeclareWinner, contractOpenCycle, ContractVersion } from "@/lib/server/crackpotContract";
import { buildNewCycle, getCycleExpiresAt } from "@/lib/server/crackpotEngine";
import { type CrackPotVersion } from "@/lib/crackpotTypes";
import {
  type CrackPotCycle,
  type CrackPotAttempt,
  type GuessView,
  THEMES,
} from "@/lib/crackpotTypes";
import {
  computeFeedback,
  applyNoise,
  isAttemptExpired,
  isCooldownActive,
} from "@/lib/server/crackpotEngine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, attemptId, symbols } = body as {
      address: string;
      attemptId: string;
      symbols: [number, number, number, number];
    };

    if (
      !address || !attemptId ||
      !Array.isArray(symbols) || symbols.length !== 4 ||
      symbols.some((s) => typeof s !== "number" || s < 0 || s > 5)
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const playerAddress = address.toLowerCase();

    const { data: attemptRow } = await supabase
      .from("crackpot_attempts")
      .select("*")
      .eq("id", attemptId)
      .eq("player_address", playerAddress)
      .maybeSingle();

    if (!attemptRow) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    const attempt = attemptRow as CrackPotAttempt;

    if (attempt.status !== "active") {
      return NextResponse.json({ error: "Attempt is not active" }, { status: 409 });
    }
    if (isAttemptExpired(attempt.expires_at)) {
      await supabase.from("crackpot_attempts").update({ status: "expired" }).eq("id", attempt.id);
      return NextResponse.json({ error: "Attempt timer expired" }, { status: 410 });
    }

    const { data: cycleRow } = await supabase
      .from("crackpot_cycles")
      .select("*")
      .eq("id", attempt.cycle_id)
      .maybeSingle();

    if (!cycleRow || cycleRow.status !== "active") {
      return NextResponse.json({ error: "Cycle not active" }, { status: 409 });
    }
    const cycle = cycleRow as CrackPotCycle & { secret_code: [number, number, number, number] };
    const isUsdt = cycle.version === "usdt";

    // 15s cooldown
    const { data: lastGuess } = await supabase
      .from("crackpot_guesses")
      .select("created_at")
      .eq("attempt_id", attempt.id)
      .order("guess_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastGuess && isCooldownActive(lastGuess.created_at)) {
      const elapsed = (Date.now() - new Date(lastGuess.created_at).getTime()) / 1000;
      return NextResponse.json(
        { error: "Cooldown active", secondsRemaining: Math.ceil(15 - elapsed) },
        { status: 429 },
      );
    }

    const secret = cycle.secret_code as [number, number, number, number];
    const trueFeedback = computeFeedback(secret, symbols as [number, number, number, number]);
    const noisyFeedback = applyNoise(trueFeedback, cycle.id, playerAddress, attempt.guesses_used + 1);

    const isCorrect = trueFeedback.every((f) => f === "locked");
    const lockedCount = noisyFeedback.filter((f) => f === "locked").length;
    const guessNumber = attempt.guesses_used + 1;

    await supabase.from("crackpot_guesses").insert({
      attempt_id: attempt.id,
      cycle_id: cycle.id,
      player_address: playerAddress,
      guess_number: guessNumber,
      symbols,
      feedback: noisyFeedback,
      locked_count: lockedCount,
      is_correct: isCorrect,
    });

    await supabase
      .from("crackpot_attempts")
      .update({ guesses_used: guessNumber, status: isCorrect ? "won" : "active" })
      .eq("id", attempt.id);

    const theme = THEMES[cycle.theme as keyof typeof THEMES];
    const guessView: GuessView = {
      guessNumber,
      symbols: symbols as [number, number, number, number],
      symbolLabels: (symbols as number[]).map((i) => theme.symbolLabels[i]) as [string, string, string, string],
      feedback: noisyFeedback,
      isCorrect,
      createdAt: new Date().toISOString(),
    };

    if (!isCorrect) {
      return NextResponse.json({
        guess: guessView,
        won: false,
        potBalance: cycle.pot_balance,
        potBalanceUsdt: isUsdt ? cycle.pot_balance / 100 : undefined,
      });
    }

    // ── Win condition — atomic claim ──────────────────────────────
    const { data: updatedCycle, error: winErr } = await supabase
      .from("crackpot_cycles")
      .update({ status: "cracked", winner_address: playerAddress, winner_guesses: guessNumber })
      .eq("id", cycle.id)
      .eq("status", "active")
      .select("pot_balance, version")
      .single();

    if (winErr || !updatedCycle) {
      return NextResponse.json({ guess: guessView, won: false, raced: true });
    }

    const potWon = updatedCycle.pot_balance as number;

    // ── Pay winner via contract ───────────────────────────────────
    // Contract mints Miles (Version A) or transfers USDT from its balance (Version B).
    const contractVersion = isUsdt ? ContractVersion.USDT : ContractVersion.MILES;
    const txHash = await contractDeclareWinner(contractVersion, playerAddress as `0x${string}`, guessNumber);

    await supabase.from("crackpot_cycles").update({ winner_tx_hash: txHash }).eq("id", cycle.id);

    // ── Seed next cycle immediately — rolling rounds ──────────────
    // Fire-and-forget: don't block the winner response.
    // Uses fallback entropy if BTC fetch is slow.
    ;(async () => {
      try {
        const entropyRes = await fetch("https://blockchain.info/q/latesthash").catch(() => null);
        const entropy = entropyRes?.ok ? await entropyRes.text() : `fallback-${Date.now()}`;
        const ver = (isUsdt ? "usdt" : "miles") as CrackPotVersion;
        const newCycle = buildNewCycle(entropy.trim(), ver);
        const { data: inserted } = await supabase
          .from("crackpot_cycles")
          .insert(newCycle)
          .select("id, expires_at")
          .single();
        if (inserted) {
          const contractVer = isUsdt ? ContractVersion.USDT : ContractVersion.MILES;
          contractOpenCycle(contractVer, new Date(inserted.expires_at))
            .catch((e) => console.error("[crackpot/guess] contractOpenCycle after win:", e?.message));
        }
      } catch (e: any) {
        console.error("[crackpot/guess] rolling seed failed:", e?.message);
      }
    })();

    if (isUsdt) {
      return NextResponse.json({ guess: guessView, won: true, potWonUsdt: potWon / 100, txHash, totalGuesses: guessNumber });
    }
    return NextResponse.json({ guess: guessView, won: true, potWon, txHash, totalGuesses: guessNumber });
  } catch (err: any) {
    console.error("[crackpot/guess]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
