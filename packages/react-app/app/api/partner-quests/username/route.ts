// src/app/api/partner-quests/username/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getReferralTag, submitReferral } from "@divvi/referral-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import MiniPointsAbi from "@/contexts/minimiles.json";

/* ─── env / clients ─────────────────────────────────────── */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const CONTRACT_ADDRESS = "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b";

// must match partner_quests.id and the Quest in partner-quests.tsx
const USERNAME_QUEST_ID = "f18818cf-eec4-412e-8311-22e09a1332db";

// 50 akibaMiles for setting username
const USERNAME_REWARD_POINTS = 50;

/* ─── POST ──────────────────────────────────────────────── */

export async function POST(request: Request) {
  try {
    const { userAddress, username } = (await request.json()) as {
      userAddress?: string;
      username?: string;
    };

    if (!userAddress || !username) {
      return NextResponse.json(
        { error: "userAddress and username are required" },
        { status: 400 },
      );
    }

    const addr = userAddress as `0x${string}`;

    /* 1 ▸ one-time check in partner_engagements */
    const { data: existing, error: checkErr } = await supabase
      .from("partner_engagements")
      .select("id", { count: "exact" })
      .eq("user_address", addr)
      .eq("partner_quest_id", USERNAME_QUEST_ID)
      .limit(1);

    if (checkErr) {
      console.error("[username-quest] DB check error:", checkErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "Quest already claimed" },
        { status: 400 },
      );
    }

    /* 2 ▸ upsert username into users table */
    // assumes "user_address" is unique or primary key in users table
    const { error: upsertErr } = await supabase
      .from("users")
      .upsert(
        {
          user_address: addr,
          username: username.trim(),
        },
        { onConflict: "user_address" },
      );

    if (upsertErr) {
      console.error("[username-quest] upsert user error:", upsertErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    /* 3 ▸ mint 50 points via MiniPoints contract (same pattern as claim route) */
    const points = USERNAME_REWARD_POINTS;

    const referralTag = getReferralTag({
      user: account.address as `0x${string}`, // The address making the transaction
      consumer: "0x03909bb1E9799336d4a8c49B74343C2a85fDad9d", // Your Divvi Identifier
    });

    const { request: txReq } = await publicClient.simulateContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [addr, parseUnits(points.toString(), 18)],
      account,
      dataSuffix: `0x${referralTag}`,
    });

    const txHash = await walletClient.writeContract(txReq);

    submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
      console.error("[username-quest] Divvi submitReferral failed", e),
    );

    /* 4 ▸ record engagement so quest becomes 'Completed' */
    const { error: insertEngagementErr } = await supabase
      .from("partner_engagements")
      .insert({
        user_address: addr,
        partner_quest_id: USERNAME_QUEST_ID,
        claimed_at: new Date().toISOString(),
        points_awarded: points,
      });

    if (insertEngagementErr) {
      console.error(
        "[username-quest] insert partner_engagements error:",
        insertEngagementErr,
      );
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    /* 5 ▸ done */
    return NextResponse.json(
      { minted: points, txHash, username: username.trim() },
      { status: 200 },
    );
  } catch (err) {
    console.error("[username-quest] unexpected:", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
