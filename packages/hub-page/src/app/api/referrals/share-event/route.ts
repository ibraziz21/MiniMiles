/**
 * POST /api/referrals/share-event
 *
 * Optional authenticated analytics endpoint (referral-system-spec.md §8).
 * Records share intent only — an enumerated channel, no arbitrary metadata,
 * no reward effect. Rate-limited per user.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";

const ALLOWED_CHANNELS = new Set(["copy", "native_share", "whatsapp"]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await checkRateLimit({
    scope: `referral_share_event:user:${user.id}`,
    limit: 30,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { channel?: unknown };
  const channel = typeof body.channel === "string" ? body.channel : "";
  if (!ALLOWED_CHANNELS.has(channel)) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("referral_events").insert({
    actor_type: "user",
    actor_id: user.id,
    event_type: "referral_share_tap",
    metadata: { channel },
  });

  if (error) {
    console.error("[referrals/share-event] insert failed:", error.message);
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
