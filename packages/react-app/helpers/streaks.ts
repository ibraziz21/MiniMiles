// src/helpers/streaks.ts
import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import MiniPointsAbi from "@/contexts/minimiles.json";
import { getReferralTag, submitReferral } from "@divvi/referral-sdk";

const {
  SUPABASE_URL = "",
  SUPABASE_SERVICE_KEY = "",
  PRIVATE_KEY = "",
  MINIPOINTS_ADDRESS = "",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRIVATE_KEY || !MINIPOINTS_ADDRESS) {
  console.warn("[streaks] Missing one or more env vars");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);

export const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

export const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http("https://forno.celo.org"),
});

export type StreakScope = "daily" | "weekly";

/**
 * Compute a scope key for logging in DB:
 *  - daily:  "YYYY-MM-DD"
 *  - weekly: "YYYY-Www" (ISO week)
 */
export function scopeKeyFor(scope: StreakScope, now = new Date()): string {
  if (scope === "daily") {
    return now.toISOString().slice(0, 10);
  }

  // Weekly → ISO week string
  const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = tmp.getUTCDay() || 7; // Sunday=7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Generic helper:
 *  - enforce "once per scope" restriction via daily_engagements
 *  - mint MiniMiles points to user
 *  - log row in daily_engagements
 */
export async function claimStreakReward(opts: {
  userAddress: string;
  questId: string;
  points: number;
  scope: StreakScope;
  label?: string; // for logging / analytics
}) {
  const { userAddress, questId, points, scope, label } = opts;

  const key = scopeKeyFor(scope);

  // 1) has already claimed in this scope?
  const { data: claimed, error: checkErr } = await supabase
    .from("daily_engagements")
    .select("id")
    .eq("user_address", userAddress)
    .eq("quest_id", questId)
    .eq("claimed_at", key)
    .maybeSingle();

  if (checkErr) {
    console.error("[claimStreakReward] check failed", label, checkErr);
  }

  if (claimed) {
    return { ok: false as const, code: "already" as const, scopeKey: key };
  }

  // 2) mint MiniMiles
  const referralTag = getReferralTag({
    user: account.address as `0x${string}`,
    consumer: "0x03909bb1E9799336d4a8c49B74343C2a85fDad9d", // Divvi identifier
  });

  const { request } = await publicClient.simulateContract({
    address: MINIPOINTS_ADDRESS as `0x${string}`,
    abi: MiniPointsAbi.abi,
    functionName: "mint",
    args: [userAddress as `0x${string}`, parseUnits(points.toString(), 18)],
    account,
    dataSuffix: `0x${referralTag}`,
  });

  const txHash = await walletClient.writeContract(request);

  submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
    console.error("[claimStreakReward] Divvi submitReferral failed", label, e)
  );

  // 3) log DB
  const { error: insertErr } = await supabase.from("daily_engagements").insert({
    user_address: userAddress,
    quest_id: questId,
    claimed_at: key,
    points_awarded: points,
  });

  if (insertErr) {
    console.error("[claimStreakReward] insert failed", label, insertErr);
  }

  return {
    ok: true as const,
    txHash,
    scopeKey: key,
  };
}
