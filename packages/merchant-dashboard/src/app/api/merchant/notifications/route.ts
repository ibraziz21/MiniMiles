// GET /api/merchant/notifications  — notification history for this partner
// Supports ?limit= and ?offset= for pagination

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);
  const offset = Number(searchParams.get("offset") ?? "0");

  const { data, error, count } = await supabase
    .from("merchant_notification_log")
    .select("*", { count: "exact" })
    .eq("partner_id", session.partnerId)
    .order("sent_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });

  return NextResponse.json({ notifications: data ?? [], total: count ?? 0, limit, offset });
}
