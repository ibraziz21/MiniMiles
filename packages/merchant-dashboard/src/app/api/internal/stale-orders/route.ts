// POST /api/internal/stale-orders
// Called by cron job every 30 minutes.
// Finds orders stuck in 'placed' or 'accepted' beyond each partner's stale threshold
// and sends reminder emails if notifications are enabled.
//
// Protected by x-webhook-secret header.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendStaleOrderEmail } from "@/lib/notify";

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all partner settings where stale notifications are enabled
    const { data: settingsList } = await supabase
      .from("partner_settings")
      .select("partner_id,stale_threshold_hours,notify_stale_order,store_active")
      .eq("notify_stale_order", true);

    if (!settingsList || settingsList.length === 0) {
      return NextResponse.json({ ok: true, checked: 0 });
    }

    let reminded = 0;
    const now = Date.now();

    for (const settings of settingsList) {
      if (!settings.store_active) continue;

      const thresholdMs = settings.stale_threshold_hours * 60 * 60 * 1000;
      const cutoff = new Date(now - thresholdMs).toISOString();

      // Find orders stuck in 'placed' or 'accepted' past the threshold
      const { data: staleOrders } = await supabase
        .from("merchant_transactions")
        .select("id,item_name,recipient_name,city,status,created_at,partner_id")
        .eq("partner_id", settings.partner_id)
        .in("status", ["placed", "accepted"])
        .lt("created_at", cutoff);

      if (!staleOrders || staleOrders.length === 0) continue;

      // Fetch partner name
      const { data: partner } = await supabase
        .from("partners")
        .select("name")
        .eq("id", settings.partner_id)
        .single();

      const partnerName = partner?.name ?? "Merchant";

      for (const order of staleOrders) {
        // Check: was a stale reminder already sent for this order in the last threshold period?
        const { data: recentNotif } = await supabase
          .from("merchant_notification_log")
          .select("id")
          .eq("partner_id", settings.partner_id)
          .eq("order_id", order.id)
          .eq("type", "stale_order")
          .gte("sent_at", cutoff)
          .maybeSingle();

        if (recentNotif) continue; // already reminded recently

        const hoursSincePlaced = Math.floor(
          (now - new Date(order.created_at).getTime()) / (1000 * 60 * 60),
        );

        const sent = await sendStaleOrderEmail({
          partnerId: settings.partner_id,
          partnerName,
          orderId: order.id,
          itemName: order.item_name ?? "Order",
          recipientName: order.recipient_name ?? "Customer",
          currentStatus: order.status,
          hoursSincePlaced,
        });

        if (sent) reminded++;
      }
    }

    return NextResponse.json({ ok: true, reminded });
  } catch (err: any) {
    console.error("[stale-orders] unexpected error", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
