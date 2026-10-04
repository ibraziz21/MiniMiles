// POST /api/me/discovery-contributions/:contributionId/photos/:photoId/complete
// Confirms the owner-bound upload actually landed, then hands the photo to the
// processing worker. The object key is derived server-side from the
// authenticated contribution/photo, never accepted from the client
// (verified-discovery-acquisition-v1-spec.md §11.2, §17).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/push/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_BUCKET = "discovery-visit-photos";

export async function POST(req: Request, { params }: { params: { id: string; photoId: string } }) {
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
  const { data: photo, error: fetchError } = await admin
    .from("merchant_visit_photos")
    .select("id, private_source_key, moderation_status")
    .eq("id", params.photoId)
    .eq("contribution_id", params.id)
    .eq("hub_user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    console.error("[discovery-photos/complete] lookup failed:", fetchError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!photo) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (["processing", "pending", "approved"].includes(photo.moderation_status)) {
    return NextResponse.json(
      { ok: true, photoId: params.photoId, status: photo.moderation_status, idempotent: true },
      { status: photo.moderation_status === "processing" ? 202 : 200 },
    );
  }
  if (photo.moderation_status !== "uploading") {
    return NextResponse.json({ error: "invalid_state" }, { status: 409 });
  }

  const objectDir = photo.private_source_key.split("/").slice(0, -1).join("/");
  const objectName = photo.private_source_key.split("/").at(-1) ?? "";
  const { data: listing, error: listError } = await admin.storage
    .from(SOURCE_BUCKET)
    .list(objectDir, { search: objectName });

  if (listError) {
    console.error("[discovery-photos/complete] storage list failed:", listError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!listing?.some((obj) => obj.name === objectName)) {
    return NextResponse.json({ error: "upload_not_found" }, { status: 409 });
  }

  // Single atomic RPC — the status flip and job enqueue used to be two
  // separate calls; a failure between them stranded the photo at
  // 'processing' with no valid retry path (this route only accepts
  // completing from 'uploading'). One call rolls back entirely on failure.
  const { data: completed, error: completeError } = await admin.rpc("complete_discovery_photo_upload", {
    p_photo_id: params.photoId,
    p_contribution_id: params.id,
    p_hub_user_id: user.id,
  });
  if (completeError) {
    console.error("[discovery-photos/complete] complete_discovery_photo_upload failed:", completeError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const result = Array.isArray(completed) ? completed[0] : completed;
  if (!result?.ok) {
    return NextResponse.json({ error: result?.error_code ?? "invalid_state" }, { status: 409 });
  }

  // Hand off to the worker and return — this request must not itself claim
  // and process a job (hardening spec §5.5: "perform no arbitrary queue
  // claim inside the foreground request"). claim_photo_processing_jobs
  // takes the oldest pending job regardless of which photo it belongs to,
  // so calling it here could process a completely unrelated backlogged
  // photo instead of (or as well as) this one. The scheduled worker
  // (/api/internal/process-photo-jobs) is the only path that processes
  // jobs; `pnpm discovery:process-photos` triggers it on demand in local
  // development.
  return NextResponse.json(
    { ok: true, photoId: params.photoId, status: result.current_state ?? "processing", idempotent: result.idempotent === true },
    { status: 202 },
  );
}
