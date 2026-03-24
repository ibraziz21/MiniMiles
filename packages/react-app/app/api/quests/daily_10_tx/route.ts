/* ────────────────────────────────────────────────────────────────────────────
   /api/quests/daily_five_txs/route.ts
   “Send at least 5 transfers (cUSD + USDT combined) in the last 24 h”
   ------------------------------------------------------------------------- */

   import { NextResponse } from "next/server";
   import { claimQueuedDailyReward } from "@/lib/minipointQueue";
   import { countOutgoingTransfersIn24H } from "@/helpers/graphQuestTransfer";
   
   /* ─── env ────────────────────────────────────────────────── */
   
   /* ─── route handler ─────────────────────────────────────── */
   
   export async function POST(req: Request) {
     try {
       const { userAddress, questId } = await req.json();
   
       /* 1 ▸ already claimed today? */
       const today = new Date().toISOString().slice(0, 10);
       /* 1 ▸ count transfers via subgraph */
       const txs = await countOutgoingTransfersIn24H(userAddress);
       if (txs < 10)
         return NextResponse.json({
           success: false,
           message: `Only ${txs}/10 transfers in the last 24 h`,
         });
       const result = await claimQueuedDailyReward({
         userAddress,
         questId,
         points: 60,
         scopeKey: today,
         reason: `daily-10tx:${questId}`,
       });

       if (!result.ok && result.code === "already") {
         return NextResponse.json({ success: false, code: "already" });
       }

       if (!result.ok) {
         return NextResponse.json(
           { success: false, message: result.message ?? "queue-error" },
           { status: 500 }
         );
       }

       return NextResponse.json({
         success: true,
         txHash: result.txHash,
         queued: result.queued,
       });
     } catch (err) {
       console.error("[DAILY-5TX]", err);
       return NextResponse.json({ success: false, message: "server-error" });
     }
   }
   
