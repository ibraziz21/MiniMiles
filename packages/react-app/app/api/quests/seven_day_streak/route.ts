// src/app/api/quests/seven_day_streak/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import { getReferralTag, submitReferral } from "@divvi/referral-sdk";
import MiniPointsAbi from "@/contexts/minimiles.json";

/* ───────────────────────── env ────────────────────────── */
const {
  SUPABASE_URL = "",
  SUPABASE_SERVICE_KEY = "",
  PRIVATE_KEY = "",
  MINIPOINTS_ADDRESS = "",
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});
const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http("https://forno.celo.org"),
});

/* ───────────────────────── consts ─────────────────────── */

// This is the quest for "Daily send ≥ $1" (used as the base condition)
const DAILY_SEND_QUEST_ID = "383eaa90-75aa-4592-a783-ad9126e8f04d";

// This must match the ID used in DailyChallenges.tsx
const SEVEN_DAY_STREAK_QUEST_ID = "6ddc811a-1a4d-4e57-871d-836f07486531";

// Reward for completing the 7-day streak
const STREAK_REWARD_POINTS = 200;

/* ───────────────────────── helpers ────────────────────── */

function getLast7DatesUtc(): { dates: string[]; oldest: string; newest: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const newest = dates[0]; // today
  const oldest = dates[6]; // 6 days ago
  return { dates, oldest, newest };
}

/* ───────────────────────── POST ───────────────────────── */

export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    if (!userAddress || !questId) {
      return NextResponse.json({
        success: false,
        message: "missing-params",
      });
    }

    if (questId !== SEVEN_DAY_STREAK_QUEST_ID) {
      return NextResponse.json({
        success: false,
        message: "invalid-quest",
      });
    }

    const { dates, oldest, newest } = getLast7DatesUtc();

    /* 1 ▸ has user already claimed this streak within this window? */
    const { data: alreadyClaimed, error: alreadyErr } = await supabase
      .from("daily_engagements")
      .select("id")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .gte("claimed_at", oldest)
      .lte("claimed_at", newest)
      .maybeSingle();

    if (alreadyErr) {
      console.error("[seven_day_streak] error checking existing claims", alreadyErr);
    }

    if (alreadyClaimed) {
      return NextResponse.json({ success: false, code: "already" });
    }

    /* 2 ▸ check that the user completed the daily $1 SEND quest
           for all of the last 7 days (consecutive streak) */
    const { data: streakRows, error: streakErr } = await supabase
      .from("daily_engagements")
      .select("claimed_at")
      .eq("user_address", userAddress)
      .eq("quest_id", DAILY_SEND_QUEST_ID)
      .in("claimed_at", dates);

    if (streakErr) {
      console.error("[seven_day_streak] streak query error", streakErr);
      return NextResponse.json({
        success: false,
        message: "server-error",
      });
    }

    const streakCount = streakRows?.length ?? 0;

    if (streakCount !== 7) {
      return NextResponse.json({
        success: false,
        message: "You need 7 days in a row of sending ≥ $1 to claim this.",
      });
    }

    /* 3 ▸ mint 200 MiniMiles */
    const referralTag = getReferralTag({
      user: account.address as `0x${string}`,
      consumer: "0x03909bb1E9799336d4a8c49B74343C2a85fDad9d", // Your Divvi Identifier
    });

    const { request } = await publicClient.simulateContract({
      address: MINIPOINTS_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits(STREAK_REWARD_POINTS.toString(), 18)],
      account,
      dataSuffix: `0x${referralTag}`,
    });

    const txHash = await walletClient.writeContract(request);

    submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
      console.error("[seven_day_streak] Divvi submitReferral failed", e),
    );

    /* 4 ▸ log the quest claim in DB */
    const todayStr = new Date().toISOString().slice(0, 10);
    const { error: insertErr } = await supabase.from("daily_engagements").insert({
      user_address: userAddress,
      quest_id: questId,
      claimed_at: todayStr,
      points_awarded: STREAK_REWARD_POINTS,
    });

    if (insertErr) {
      console.error("[seven_day_streak] insert error", insertErr);
      // We already minted, so just report success but note DB error server-side
    }

    return NextResponse.json({ success: true, txHash });
  } catch (err) {
    console.error("[seven_day_streak]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
