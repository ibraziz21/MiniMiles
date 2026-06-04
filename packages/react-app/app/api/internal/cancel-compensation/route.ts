// POST /api/internal/cancel-compensation
// Internal webhook called by the merchant dashboard when an order is cancelled.
// Runs the compensation flow: voucher reinstatement + refund record.
// Protected by x-webhook-secret header.

import { NextResponse } from "next/server";
import { handleOrderCancellation } from "@/lib/orderCancellation";

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { orderId } = body;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const result = await handleOrderCancellation(orderId);

  return NextResponse.json({ ok: true, ...result });
}
