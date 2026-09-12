// lib/server/questReward.ts
//
// Vault-aware quest reward calculation, shared by the sponsored mint queue
// (lib/minipointQueue.ts) and the daily self-claim voucher route
// (docs/daily-checkin-self-claim-spec.md §3). Extracted so both paths freeze
// the exact same reward for a given wallet/basePoints at the moment of
// calculation — the caller is responsible for freezing the result (only a
// newly created record should call this; retries reuse the stored values).

import { supabase } from "@/lib/supabaseClient";

export type QuestVaultBoost = {
  applied: boolean;
  multiplier: number;
  balanceUsdt?: string;
  minBalanceUsdt: number;
};

export type QuestReward = {
  basePoints: number;
  awardedPoints: number;
  vaultBoost: QuestVaultBoost;
};

const VAULT_QUEST_REWARD_MULTIPLIER = Number(
  process.env.VAULT_QUEST_REWARD_MULTIPLIER ??
    process.env.NEXT_PUBLIC_VAULT_QUEST_REWARD_MULTIPLIER ??
    "1.5"
);
const VAULT_QUEST_BOOST_MIN_BALANCE = Number(
  process.env.VAULT_QUEST_BOOST_MIN_BALANCE ??
    process.env.NEXT_PUBLIC_VAULT_QUEST_BOOST_MIN_BALANCE ??
    "0.000001"
);

async function getVaultBalanceUsdt(userAddress: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("vault_positions")
    .select("balance_usdt")
    .eq("wallet_address", userAddress.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("[questReward] vault position lookup failed", error.message);
    return null;
  }

  return data?.balance_usdt == null ? null : String(data.balance_usdt);
}

export async function computeQuestReward(userAddress: string, basePoints: number): Promise<QuestReward> {
  const multiplier =
    Number.isFinite(VAULT_QUEST_REWARD_MULTIPLIER) && VAULT_QUEST_REWARD_MULTIPLIER > 1
      ? VAULT_QUEST_REWARD_MULTIPLIER
      : 1;
  const minBalanceUsdt =
    Number.isFinite(VAULT_QUEST_BOOST_MIN_BALANCE) && VAULT_QUEST_BOOST_MIN_BALANCE > 0
      ? VAULT_QUEST_BOOST_MIN_BALANCE
      : 0;

  const balanceUsdt = multiplier > 1 ? await getVaultBalanceUsdt(userAddress) : null;
  const balance = Number(balanceUsdt ?? "0");
  const applied = multiplier > 1 && Number.isFinite(balance) && balance >= minBalanceUsdt;
  const awardedPoints = applied ? Math.ceil(basePoints * multiplier) : basePoints;

  return {
    basePoints,
    awardedPoints,
    vaultBoost: {
      applied,
      multiplier,
      balanceUsdt: balanceUsdt ?? undefined,
      minBalanceUsdt,
    },
  };
}
