/**
 * POST /api/me/pass/regenerate
 *
 * Issues a new public_pass_id for the authenticated Hub user, invalidating
 * any previously saved QR images.
 *
 * The user should be warned that old saved passes stop working after regeneration.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!user.email) {
    return NextResponse.json({ error: "Account has no email" }, { status: 422 });
  }

  const admin = createAdminClient();
  const newPassId = randomUUID();

  // Try to update existing row first
  const { data: updated } = await admin
    .from("hub_user_passes")
    .update({ public_pass_id: newPassId, regenerated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("public_pass_id")
    .single();

  if (!updated?.public_pass_id) {
    // No pass row yet — create one (treats regenerate as first-issue)
    const { data: inserted } = await admin
      .from("hub_user_passes")
      .insert({ user_id: user.id, email: user.email, public_pass_id: newPassId })
      .select("public_pass_id")
      .single();

    if (!inserted?.public_pass_id) {
      return NextResponse.json({ error: "Could not regenerate pass" }, { status: 500 });
    }

    return NextResponse.json({
      publicPassId: inserted.public_pass_id,
      qrPayload: `akiba-pass:v1:${inserted.public_pass_id}`,
    });
  }

  return NextResponse.json({
    publicPassId: updated.public_pass_id,
    qrPayload: `akiba-pass:v1:${updated.public_pass_id}`,
  });
}
