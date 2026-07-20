/**
 * GET /api/me/pass
 *
 * Returns the authenticated Hub user's stable Akiba Pass identifier.
 * Creates the pass row on first call (idempotent).
 *
 * The returned publicPassId is a stable UUID — it does not expire.
 * The qrPayload is the string to encode in the QR canvas.
 *
 * Used by AkibaPassCard on the /me profile page.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitQuestAction } from "@/lib/akiba/quest-events";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!user.email) {
    return NextResponse.json({ error: "Account has no email — cannot issue pass" }, { status: 422 });
  }

  const admin = createAdminClient();

  // Fetch the stable pass row for this user
  let { data: passRow } = await admin
    .from("hub_user_passes")
    .select("public_pass_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // First visit: create the pass row
  if (!passRow) {
    const { data: inserted } = await admin
      .from("hub_user_passes")
      .insert({ user_id: user.id, email: user.email })
      .select("public_pass_id")
      .single();
    passRow = inserted;

    // Report the pass-signup quest action (fire-and-forget, deduped on Platform).
    if (passRow?.public_pass_id) {
      await emitQuestAction({
        actionName: "pass_signup",
        userId: user.id,
        idempotencyKey: `quest-pass_signup-${user.id}`,
        metadata: { email: user.email },
      });
    }
  }

  if (!passRow?.public_pass_id) {
    return NextResponse.json({ error: "Could not issue pass" }, { status: 500 });
  }

  return NextResponse.json({
    publicPassId: passRow.public_pass_id,
    qrPayload: `akiba-pass:v1:${passRow.public_pass_id}`,
  });
}
