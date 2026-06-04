// POST /api/Spend/orders/rewards/process
// Mints +200 AkibaMiles for a confirmed order.
// Called by the confirm-received route (internal) and by the admin retry job.
//
// Protected by ADMIN_QUEUE_SECRET — same pattern as /api/admin/drain-mint-queue.
// Header:  Authorization: Bearer <ADMIN_QUEUE_SECRET>
//
// Body: { order_id: string }

import { NextResponse } from "next/server";
import { processOrderMilesReward } from "@/lib/orderMilesReward";

const ADMIN_QUEUE_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

function isAuthorized(req: Request): boolean {
  if (!ADMIN_QUEUE_SECRET) return false;
  return req.headers.get("authorization") === `Bearer ${ADMIN_QUEUE_SECRET}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
