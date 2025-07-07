// src/app/api/partner-quests/claim/route.ts
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

const CONTRACT_ADDRESS = "0xb0012Ff26b6eB4F75d09028233204635c0332050";

/* ─── POST ──────────────────────────────────────────────── */

export async function POST(request: Request) {
  try {
    const { userAddress, questId } = (await request.json()) as {
      userAddress?: string;
      questId?: string;
    };

    if (!userAddress || !questId) {
      return NextResponse.json(
        { error: "userAddress and questId are required" },
        { status: 400 },
      );
    }

    /* 1 ▸ one-time check */
    const { data: existing, error: checkErr } = await supabase
      .from("partner_engagements")
      .select("id", { count: "exact" })
      .eq("user_address", userAddress)
      .eq("partner_quest_id", questId)
      .limit(1);

    if (checkErr) {
      console.error("[partner-claim] DB check error:", checkErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "Quest already claimed" },
        { status: 400 },
      );
    }

    /* 2 ▸ get reward points */
    const { data: quest, error: questErr } = await supabase
      .from("partner_quests")
      .select("reward_points")
      .eq("id", questId)
      .single();

    if (questErr || !quest) {
      console.error("[partner-claim] quest lookup error:", questErr);
      return NextResponse.json({ error: "Quest not found" }, { status: 404 });
    }

    const points = quest.reward_points;

    /* 3 ▸ mint */
    const { request: txReq } = await publicClient.simulateContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits(points.toString(), 18)],
      account,
    });
    const txHash = await walletClient.writeContract(txReq);

    /* 4 ▸ record engagement */
    const { error: insertErr } = await supabase.from("partner_engagements").insert({
      user_address: userAddress,
      partner_quest_id: questId,
      claimed_at: new Date().toISOString(),
      points_awarded: points,
    });

    if (insertErr) {
      console.error("[partner-claim] insert error:", insertErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    /* 5 ▸ done */
    return NextResponse.json({ minted: points, txHash }, { status: 200 });
  } catch (err) {
    console.error("[partner-claim] unexpected:", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
