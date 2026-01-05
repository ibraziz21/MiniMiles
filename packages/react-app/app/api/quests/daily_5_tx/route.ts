/* ────────────────────────────────────────────────────────────────────────────
   /api/quests/daily_five_txs/route.ts
   “Send at least 5 transfers (cUSD + USDT combined) in the last 24 h”
   ------------------------------------------------------------------------- */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getReferralTag, submitReferral } from '@divvi/referral-sdk'

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { gql, request } from "graphql-request";

import MiniPointsAbi from "@/contexts/minimiles.json";

/* ─── env ────────────────────────────────────────────────── */

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  PRIVATE_KEY,
  MINIPOINTS_ADDRESS,
} = process.env as Record<string, string>;

const SUBGRAPH_CUSD = "https://api.studio.thegraph.com/query/114722/transfers-18-d/version/latest"  // https://api.studio…thegraph.com/query/…/transfers-18-d/…
const SUBGRAPH_USDT = "https://api.studio.thegraph.com/query/1717663/usd-transfers/version/latest"  // https://api.studio…thegraph.com/query/…/transfers-6-d/…
if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_KEY ||
  !PRIVATE_KEY ||
  !MINIPOINTS_ADDRESS ||
  !SUBGRAPH_CUSD ||
  !SUBGRAPH_USDT
) {
  throw new Error("[DAILY-5TX] Missing env vars");
}

/* ─── clients ────────────────────────────────────────────── */

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

/* ─── GraphQL document (shared by both subgraphs) ───────── */

const TRANSFER_COUNT_Q = gql`
     query ($user: Bytes!, $since: BigInt!, $limit: Int!) {
       transfers(
         first: $limit
         where: { from: $user, blockTimestamp_gt: $since }
       ) {
         id
       }
     }
   `;

/* ─── helper: count outgoing transfers via subgraph ─────── */

async function countTransfersIn24H(user: string): Promise<number> {
  const urls = [SUBGRAPH_CUSD, SUBGRAPH_USDT];
  const since = (Math.floor(Date.now() / 1_000) - 86_400).toString();
  const LIMIT = 1000; // plenty; we bail at 5 anyway

  let total = 0;

  for (const url of urls) {
    const { transfers } = await request<{
      transfers: { id: string }[];
    }>(url, TRANSFER_COUNT_Q, {
      user: user.toLowerCase(),
      since,
      limit: LIMIT,
    });

    total += transfers.length;
    if (total >= 5) return total; // early exit
  }
  return total;
}

/* ─── route handler ─────────────────────────────────────── */

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

    if (claimed)
      return NextResponse.json({ success: false, code: "already" });

    /* 2 ▸ count transfers via subgraph */
    const txs = await countTransfersIn24H(userAddress);
    if (txs < 5)
      return NextResponse.json({
        success: false,
        message: `Only ${txs}/5 transfers in the last 24 h`,
      });

      const referralTag = getReferralTag({
        user: account.address as `0x${string}`, // The user address making the transaction
        consumer: '0x03909bb1E9799336d4a8c49B74343C2a85fDad9d', // Your Divvi Identifier
      })

    /* 3 ▸ mint 20 MiniMiles */
    const { request: sim } = await publicClient.simulateContract({
      address: MINIPOINTS_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("50", 18)],
      account,
      dataSuffix: `0x${referralTag}`
    });
    const txHash = await walletClient.writeContract(sim);

    submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
      console.error("Divvi submitReferral failed", e)
    )

    /* 4 ▸ log engagement */
    await supabase.from("daily_engagements").insert({
      user_address: userAddress,
      quest_id: questId,
      claimed_at: today,
      points_awarded: 50,
    });

    return NextResponse.json({ success: true, txHash });
  } catch (err) {
    console.error("[DAILY-5TX]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
