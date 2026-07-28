/**
 * POST /api/me/onboarding
 *
 * Marks the /welcome onboarding carousel as seen for the authenticated Hub
 * user (via skip or completion) — never shown again after this.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("hub_user_passes")
    .update({ onboarding_seen_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
