// POST /api/admin/discovery-photos/:id/preview-url
// Mints a short-lived signed URL for the private derived-image bucket so a
// moderator can actually view a pending photo before approving/rejecting
// it — same pattern as /api/admin/subscription-payments/:id/evidence-url.
// The browser never receives the Supabase service key.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DERIVED_BUCKET = "discovery-visit-photos-derived";
const PREVIEW_URL_TTL_SECONDS = 300;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("discovery.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!UUID_PATTERN.test(params.id)) {
    return NextResponse.json({ error: "Invalid photo ID." }, { status: 400 });
  }

  const { data: photo, error } = await supabase
    .from("merchant_visit_photos")
    .select("display_key, thumbnail_key")
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    console.error("[discovery-photos] preview lookup failed:", error.message);
    return NextResponse.json({ error: "Failed to load photo." }, { status: 500 });
  }
  const key = photo?.display_key ?? photo?.thumbnail_key;
  if (!key) {
    return NextResponse.json({ error: "No derivative is available for this photo yet." }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(DERIVED_BUCKET)
    .createSignedUrl(key, PREVIEW_URL_TTL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    console.error("[discovery-photos] sign error:", signErr?.message);
    return NextResponse.json({ error: "Could not sign preview URL." }, { status: 502 });
  }

  return NextResponse.json(
    { url: signed.signedUrl, expiresInSeconds: PREVIEW_URL_TTL_SECONDS },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
