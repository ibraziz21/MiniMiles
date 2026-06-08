// server/farkle/grantRewards.ts
// Shared reward-granting logic for all Farkle match-end paths:
// bank (win by score), forfeit, and timeout.
//
// Writes the ledger entry AND mints AkibaMiles on-chain for both players.
// Fires-and-forgets the mint so the API response isn't blocked by RPC latency.

import { createClient } from "@supabase/supabase-js";
import { safeMintMiniPoints } from "@/lib/minipoints";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export interface FarkleRewardParams {
  matchId:       string;
  modeKey:       string;
  winnerAddress: string;
  loserAddress:  string;
  winnerScore:   number;
  loserScore:    number;
  winMiles:      number;
  losMiles:      number;
  winCreditCents: number;
  endReason:     "score" | "forfeit" | "timeout";
}

export async function grantFarkleRewards(p: FarkleRewardParams): Promise<void> {
  const {
    matchId, winnerAddress, loserAddress,
    winMiles, losMiles, winCreditCents,
  } = p;

  // ── Ledger entries (fast, synchronous) ───────────────────────────────────
  const ledgerRows = [
    {
      wallet_address: winnerAddress,
      amount: winMiles,
      currency: "AKIBAMILES",
      ledger_type: "AKIBAMILES_REWARD_GRANTED",
      reference_type: "match",
      reference_id: matchId,
    },
    {
      wallet_address: loserAddress,
      amount: losMiles,
      currency: "AKIBAMILES",
      ledger_type: "AKIBAMILES_REWARD_GRANTED",
      reference_type: "match",
      reference_id: matchId,
    },
  ];

  const { error: ledgerError } = await supabase.from("game_credit_ledger").insert(ledgerRows);
  if (ledgerError) {
    console.error("[grantFarkleRewards] ledger insert failed:", ledgerError.message);
  }

  // USDT reward credit for the winner (Reward Duel only)
  if (winCreditCents > 0) {
    const { data: existing } = await supabase
      .from("farkle_credit_balances")
      .select("reward_credits_cents")
      .eq("wallet_address", winnerAddress)
      .maybeSingle();

    await supabase.from("farkle_credit_balances").upsert(
      {
        wallet_address: winnerAddress,
        reward_credits_cents: (existing?.reward_credits_cents ?? 0) + winCreditCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" }
    );
  }

  // ── On-chain mints (fire-and-forget — don't block response) ──────────────
  // Both winner and loser receive AkibaMiles. A failed mint is logged for
  // manual retry; the ledger entry is the source of truth for accounting.
  const mintBoth = async () => {
    await Promise.allSettled([
      safeMintMiniPoints({ to: winnerAddress, points: winMiles, reason: `farkle-win-${matchId}` })
        .catch((e) => console.error("[grantFarkleRewards] winner mint failed:", e?.message)),
      safeMintMiniPoints({ to: loserAddress, points: losMiles, reason: `farkle-loss-${matchId}` })
        .catch((e) => console.error("[grantFarkleRewards] loser mint failed:", e?.message)),
    ]);
  };
  void mintBoth();
}
