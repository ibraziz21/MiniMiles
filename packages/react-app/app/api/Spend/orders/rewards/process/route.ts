// POST /api/Spend/orders/rewards/process
// Mints +200 AkibaMiles for a confirmed order.
// Called async by the orders route; also callable by an admin retry job.
//
// Body: { order_id: string }

import { NextResponse } from "next/server";
import { processOrderMilesReward } from "@/lib/orderMilesReward";

export async function POST(req: Request) {
  try {
    const { order_id } = await req.json();

    if (!order_id) {
      return NextResponse.json({ error: "order_id is required" }, { status: 400 });
    }

    await processOrderMilesReward(order_id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[orders/rewards/process]", err?.message);
    return NextResponse.json({ error: err?.message ?? "Reward processing failed" }, { status: 500 });
  }
}
