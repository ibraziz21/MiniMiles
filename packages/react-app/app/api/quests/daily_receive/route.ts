// src/app/api/quests/daily_receive/route.ts
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
import { userReceivedAtLeast1DollarIn24Hrs } from "@/helpers/graphQuestTransfer";

/* ─── env & clients (same as previous file) ─────────────── */
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

/* ─── POST ──────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    /* 1 ▸ already claimed today? */
    const today = new Date().toISOString().slice(0, 10);
    const { data: claimed } = await supabase
      .from("daily_engagements")
      .select("id")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claimed_at", today)
      .maybeSingle();

    if (claimed) {
      return NextResponse.json({ success: false, code: "already" });
    }

    /* 2 ▸ on-chain subgraph check */
    if (!(await userReceivedAtLeast1DollarIn24Hrs(userAddress))) {
      return NextResponse.json({
        success: false,
        message: "No incoming transfer ≥ $1 in the last 24 h",
      });
    }

    /* 3 ▸ mint 15 MiniMiles */
    const { request } = await publicClient.simulateContract({
      address: MINIPOINTS_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("15", 18)],
      account,
    });
    const txHash = await walletClient.writeContract(request);

    /* 4 ▸ log in DB */
    await supabase.from("daily_engagements").insert({
      user_address: userAddress,
      quest_id: questId,
      claimed_at: today,
      points_awarded: 15,
    });

    return NextResponse.json({ success: true, txHash });
  } catch (err) {
    console.error("[daily_receive]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
