// POST /api/me/discovery-contributions/:requestId/dismiss
// Ends the request without submitting an answer — never affects Miles
// (verified-discovery-acquisition-v1-spec.md §8.2, §8.4: "Close and `Not
// now` are always reachable").
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/push/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("discovery_contribution_requests")
    .update({ state: "dismissed", dismissed_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("hub_user_id", user.id)
    .eq("state", "open")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[discovery-contributions/:id/dismiss] update failed:", error.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
