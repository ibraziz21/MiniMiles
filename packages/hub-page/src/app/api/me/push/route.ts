import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const [{ count }, { data: prefs }] = await Promise.all([
    admin
      .from("web_push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("hub_user_id", user.id)
      .eq("status", "active"),
    admin
      .from("hub_notification_preferences")
      .select("orders_enabled, vouchers_enabled, rewards_enabled, marketing_enabled")
      .eq("hub_user_id", user.id)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    enabled: (count ?? 0) > 0,
    vapid_public_key: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? null,
    preferences: {
      orders: prefs?.orders_enabled ?? true,
      vouchers: prefs?.vouchers_enabled ?? true,
      rewards: prefs?.rewards_enabled ?? false,
      marketing: prefs?.marketing_enabled ?? false,
    },
  });
}
