// POST /api/me/discovery-contributions/:contributionId/photos/upload-intent
// Issues a short-lived signed upload URL into the PRIVATE source bucket
// (verified-discovery-acquisition-v1-spec.md §11.2, §13.2, §17). The object
// is never public: a scheduled worker (process-photo-jobs) must validate,
// strip EXIF/GPS and re-encode it before it can even reach `pending`
// moderation, let alone `approved`.
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAllRateLimits } from "@/lib/rateLimit";
import { isSameOriginRequest } from "@/lib/push/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_BUCKET = "discovery-visit-photos";
const MAX_ACTIVE_PHOTOS = 3;
const SIGNED_UPLOAD_TTL_SECONDS = 300;
// Comfortably longer than the signed-upload TTL above, so a genuinely
// in-progress upload is never mistaken for abandoned.
const UPLOADING_STALE_AFTER_MS = 15 * 60 * 1000;

// Bumped whenever the photo-consent notice's wording changes materially
// (§13.2) — the client must echo the version it actually showed the member,
// so a stale cached client can't silently upload under an outdated notice.
const CURRENT_PHOTO_CONSENT_VERSION = "v1";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

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

  const withinLimits = await checkAllRateLimits([
    { scope: `discovery_photo_upload:user:${user.id}`, limit: 10, windowSeconds: 600 },
  ]);
  if (!withinLimits) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const consentVersion = typeof body?.consentVersion === "string" ? body.consentVersion : "";
  const extension = CONTENT_TYPE_EXTENSIONS[contentType];

  if (!extension) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 400 });
  }
  if (consentVersion !== CURRENT_PHOTO_CONSENT_VERSION) {
    return NextResponse.json({ error: "stale_consent_version" }, { status: 409 });
  }

  const admin = createAdminClient();

  const { data: contribution, error: contributionError } = await admin
    .from("merchant_discovery_contributions")
    .select("id, partner_id")
    .eq("id", params.id)
    .eq("hub_user_id", user.id)
    .is("withdrawn_at", null)
    .maybeSingle();

  if (contributionError) {
    console.error("[discovery-photos/upload-intent] contribution lookup failed:", contributionError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!contribution) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A row created by an abandoned upload (member closed the tab mid-upload,
  // before calling /complete or failing in a way that withdraws it) stays
  // 'uploading' forever otherwise — exclude one older than this window so
  // it can't permanently consume a photo slot.
  const stillFreshCutoff = new Date(Date.now() - UPLOADING_STALE_AFTER_MS).toISOString();
  const { count: activeCount } = await admin
    .from("merchant_visit_photos")
    .select("id", { count: "exact", head: true })
    .eq("contribution_id", params.id)
    .not("moderation_status", "in", "(rejected,withdrawn)")
    .or(`moderation_status.neq.uploading,submitted_at.gt.${stillFreshCutoff}`);

  if ((activeCount ?? 0) >= MAX_ACTIVE_PHOTOS) {
    return NextResponse.json({ error: "photo_limit_reached" }, { status: 409 });
  }

  const photoId = randomUUID();
  const objectKey = `${params.id}/${photoId}.${extension}`;

  const { error: signError, data: signed } = await admin.storage
    .from(SOURCE_BUCKET)
    .createSignedUploadUrl(objectKey);

  if (signError || !signed) {
    console.error("[discovery-photos/upload-intent] createSignedUploadUrl failed:", signError?.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const { error: insertError } = await admin.from("merchant_visit_photos").insert({
    id: photoId,
    contribution_id: params.id,
    hub_user_id: user.id,
    partner_id: contribution.partner_id,
    private_source_key: objectKey,
    moderation_status: "uploading",
    consent_version: consentVersion,
  });

  if (insertError) {
    if (insertError.code === "23514") {
      return NextResponse.json({ error: "photo_limit_reached" }, { status: 409 });
    }
    console.error("[discovery-photos/upload-intent] insert failed:", insertError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({
    photoId,
    bucket: SOURCE_BUCKET,
    path: signed.path,
    token: signed.token,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
  });
}
