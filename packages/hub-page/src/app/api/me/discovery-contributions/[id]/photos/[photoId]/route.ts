// DELETE /api/me/discovery-contributions/:contributionId/photos/:photoId
// Photo consent/status is independently revocable (§8.5) — withdrawing one
// photo never requires withdrawing the structured contribution.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/push/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(req: Request, { params }: { params: { id: string; photoId: string } }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.photoId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("merchant_visit_photos")
    .update({ moderation_status: "withdrawn", withdrawn_at: new Date().toISOString() })
    .eq("id", params.photoId)
    .eq("contribution_id", params.id)
    .eq("hub_user_id", user.id)
    .not("moderation_status", "in", "(rejected,withdrawn)")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[discovery-photos/:photoId] withdraw failed:", error.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
