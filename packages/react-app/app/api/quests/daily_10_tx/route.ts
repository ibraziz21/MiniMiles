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
   import MiniPointsAbi from "@/contexts/minimiles.json";
   import { countOutgoingTransfersIn24H } from "@/helpers/graphQuestTransfer";
   
   /* ─── env ────────────────────────────────────────────────── */
   
   const {
     SUPABASE_URL,
     SUPABASE_SERVICE_KEY,
     PRIVATE_KEY,
     MINIPOINTS_ADDRESS,
   } = process.env as Record<string, string>;
   
   if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRIVATE_KEY || !MINIPOINTS_ADDRESS) {
     throw new Error("[DAILY-10TX] Missing env vars");
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
       const txs = await countOutgoingTransfersIn24H(userAddress);
       if (txs < 10)
         return NextResponse.json({
           success: false,
           message: `Only ${txs}/10 transfers in the last 24 h`,
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
         args: [userAddress, parseUnits("30", 18)],
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
         points_awarded: 30,
       });
   
       return NextResponse.json({ success: true, txHash });
     } catch (err) {
       console.error("[DAILY-5TX]", err);
       return NextResponse.json({ success: false, message: "server-error" });
     }
   }
   