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

const CONTRACT_ADDRESS =
  "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b" as `0x${string}`;
const DIVVI_CONSUMER =
  "0x03909bb1E9799336d4a8c49B74343C2a85fDad9d" as `0x${string}`;

// must match partner_quests.id and the Quest in partner-quests.tsx
const USERNAME_QUEST_ID = "f18818cf-eec4-412e-8311-22e09a1332db";

// 50 akibaMiles for setting username
const USERNAME_REWARD_POINTS = 50;

/* ────────────────────────────────────────────────────────── */
/* Exported helper: safe mint with nonce/gas race retries    */
/* Reuse this in other claim APIs                            */
/* ────────────────────────────────────────────────────────── */

export async function safeMintMiniPoints(params: {
  to: `0x${string}`;
  points: number;
  reason?: string; // for logging, e.g. "username-quest"
}): Promise<`0x${string}`> {
  const { to, points, reason } = params;

  const referralTag = getReferralTag({
    user: account.address as `0x${string}`,
    consumer: DIVVI_CONSUMER,
  });

  let lastError: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Always grab the latest pending nonce
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });

      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: MiniPointsAbi.abi,
        functionName: "mint",
        args: [to, parseUnits(points.toString(), 18)],
        account,
        dataSuffix: `0x${referralTag}`,
        nonce,
      });

      // Fire-and-forget Divvi tracking
      submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
        console.error("[safeMintMiniPoints] Divvi submitReferral failed", e),
      );

      return txHash as `0x${string}`;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.shortMessage || err?.message || "").toLowerCase();

      const isNonceOrGasRace =
        msg.includes("nonce too low") ||
        msg.includes("replacement transaction underpriced");

      if (!isNonceOrGasRace) {
        // Different error → bail out immediately
        throw err;
      }

      console.warn(
        `[safeMintMiniPoints] nonce/gas race${
          reason ? ` for ${reason}` : ""
        } on attempt ${attempt + 1}, retrying…`,
        msg,
      );

      // tiny jitter so concurrent requests de-sync a bit
      await new Promise((r) =>
        setTimeout(r, 150 + Math.random() * 250),
      );
    }
  }

  throw lastError ?? new Error("mint failed after nonce/gas retries");
}

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

    /* 3 ▸ mint 50 points via shared helper */
    const points = USERNAME_REWARD_POINTS;

    const txHash = await safeMintMiniPoints({
      to: addr,
      points,
      reason: "username-quest",
    });

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
  } catch (err: any) {
    console.error("[username-quest] unexpected:", err);
    return NextResponse.json(
      {
        error: "server-error",
        message: err?.shortMessage ?? err?.message ?? "Unexpected error",
      },
      { status: 500 },
    );
  }
}
