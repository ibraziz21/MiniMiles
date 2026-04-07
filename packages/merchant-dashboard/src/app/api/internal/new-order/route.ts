// POST /api/internal/new-order
// Internal webhook — called by the react-app (or a DB trigger webhook) when a
// new order is placed. Sends an email notification to all active merchant users
// for the relevant partner.
//
// Protected by a shared INTERNAL_WEBHOOK_SECRET header.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendNewOrderEmail } from "@/lib/notify";

const WEBHOOK_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;

export async function POST(req: Request) {
  // Auth
  const secret = req.headers.get("x-webhook-secret");
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  // Fetch order
  const { data: order, error: orderErr } = await supabase
    .from("merchant_transactions")
    .select("id, partner_id, item_name, recipient_name, city, amount_cusd, created_at")
    .eq("id", body.orderId)
    .eq("status", "placed")
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found or not in placed state" }, { status: 404 });
  }

  // Fetch partner info
  const { data: partner } = await supabase
    .from("partners")
    .select("name")
    .eq("id", order.partner_id)
    .single();

  const { data: settings } = await supabase
    .from("partner_settings")
    .select("notify_new_order,store_active")
    .eq("partner_id", order.partner_id)
    .maybeSingle();

  const partnerName = partner?.name ?? "your store";

  if (settings?.store_active === false) {
    return NextResponse.json({ ok: true, notified: 0, skipped: "store_inactive" });
  }

  if (settings?.notify_new_order === false) {
    return NextResponse.json({ ok: true, notified: 0, skipped: "notifications_disabled" });
  }

  const sent = await sendNewOrderEmail({
    partnerId: order.partner_id,
    partnerName,
    orderId: order.id,
    itemName: order.item_name ?? "New Order",
    recipientName: order.recipient_name ?? "Customer",
    city: order.city ?? "",
    amountCusd: Number(order.amount_cusd ?? 0),
  });

  return NextResponse.json({ ok: true, notified: sent ? 1 : 0 });
}
