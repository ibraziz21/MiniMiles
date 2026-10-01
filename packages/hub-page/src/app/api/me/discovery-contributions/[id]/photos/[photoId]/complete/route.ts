// POST /api/me/discovery-contributions/:contributionId/photos/:photoId/complete
// Confirms the signed upload actually landed, then hands the photo to the
// processing worker. The object key is derived server-side from the
// authenticated contribution/photo, never accepted from the client
// (verified-discovery-acquisition-v1-spec.md §11.2, §17).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingPhotoJobs } from "@/lib/discovery/photoProcessing";
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
  });
  if (completeError) {
    console.error("[discovery-photos/complete] complete_discovery_photo_upload failed:", completeError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const result = Array.isArray(completed) ? completed[0] : completed;
  if (!result?.ok) {
    return NextResponse.json({ error: "invalid_state" }, { status: 409 });
  }

  // Do not make a completed browser upload wait for a deployment-only cron.
  // Processing here makes the photo available to moderation immediately in
  // local development and production; the scheduled worker remains the
  // durable retry path if this best-effort pass fails.
  try {
    // A single image keeps this request's latency bounded. Concurrent photo
    // completions claim distinct jobs; any older backlog remains covered by
    // the scheduled batch worker.
    const processing = await processPendingPhotoJobs(admin, 1);
    return NextResponse.json({ ok: true, processing });
  } catch (processingError) {
    console.error(
      "[discovery-photos/complete] immediate processing failed; queued for retry:",
      processingError instanceof Error ? processingError.message : processingError,
    );
    return NextResponse.json({ ok: true, processing: { claimed: 0, succeeded: 0, failed: 0 } });
  }
}
