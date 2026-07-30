import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/push/origin";

const ALLOWED_KEYS = new Set(["orders", "vouchers"]);

export async function PATCH(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if ("rewards" in body || "marketing" in body) {
    return NextResponse.json(
      { error: "Rewards and marketing push are not available yet" },
      { status: 422 }
    );
  }

  const update: Record<string, boolean> = {};
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json({ error: `Unknown preference: ${key}` }, { status: 400 });
    }
    if (typeof body[key] !== "boolean") {
      return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
    }
    update[`${key}_enabled`] = body[key] as boolean;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("hub_notification_preferences")
    .upsert({ hub_user_id: user.id, ...update }, { onConflict: "hub_user_id" });

  if (error) {
    console.error("[push/preferences] upsert failed:", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
