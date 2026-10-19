import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAllRateLimits } from "@/lib/rateLimit";

const SOURCE_BUCKET = "discovery-visit-photos";
const MAX_ACTIVE_PHOTOS = 3;
const UPLOAD_INTENT_TTL_SECONDS = 300;
const UPLOADING_STALE_AFTER_MS = 15 * 60 * 1000;
const CURRENT_PHOTO_CONSENT_VERSION = "v1";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export class DiscoveryPhotoError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "DiscoveryPhotoError";
  }
}

export type DiscoveryPhotoUploadIntent = {
  photoId: string;
  bucket: string;
  path: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export async function createDiscoveryPhotoUploadIntent(input: {
  contributionId: string;
  userId: string;
  contentType: string;
  consentVersion: string;
}): Promise<DiscoveryPhotoUploadIntent> {
  const extension = CONTENT_TYPE_EXTENSIONS[input.contentType];
  if (!extension) throw new DiscoveryPhotoError("invalid_content_type", 400);
  if (input.consentVersion !== CURRENT_PHOTO_CONSENT_VERSION) {
    throw new DiscoveryPhotoError("stale_consent_version", 409);
  }

  const withinLimits = await checkAllRateLimits([
    { scope: `discovery_photo_upload:user:${input.userId}`, limit: 10, windowSeconds: 600 },
  ]);
  if (!withinLimits) throw new DiscoveryPhotoError("rate_limit_exceeded", 429, "Too many requests", true);

  const admin = createAdminClient();
  const { data: contribution, error: contributionError } = await admin
    .from("merchant_discovery_contributions")
    .select("id, partner_id")
    .eq("id", input.contributionId)
    .eq("hub_user_id", input.userId)
    .is("withdrawn_at", null)
    .maybeSingle();

  if (contributionError) {
    console.error("[discovery-photos/upload-intent] contribution lookup failed:", contributionError.message);
    throw new DiscoveryPhotoError("internal_error", 500, "Photo upload is temporarily unavailable", true);
  }
  if (!contribution) throw new DiscoveryPhotoError("not_found", 404);

  const stillFreshCutoff = new Date(Date.now() - UPLOADING_STALE_AFTER_MS).toISOString();
  const { count: activeCount } = await admin
    .from("merchant_visit_photos")
    .select("id", { count: "exact", head: true })
    .eq("contribution_id", input.contributionId)
    .not("moderation_status", "in", "(rejected,withdrawn)")
    .or(`moderation_status.neq.uploading,submitted_at.gt.${stillFreshCutoff}`);

  if ((activeCount ?? 0) >= MAX_ACTIVE_PHOTOS) {
    throw new DiscoveryPhotoError("photo_limit_reached", 409, "You can add up to three photos to a visit");
  }

  const photoId = randomUUID();
  const path = `${input.contributionId}/${photoId}.${extension}`;
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_SECONDS * 1000).toISOString();
  const { error: insertError } = await admin.from("merchant_visit_photos").insert({
    id: photoId,
    contribution_id: input.contributionId,
    hub_user_id: input.userId,
    partner_id: contribution.partner_id,
    private_source_key: path,
    moderation_status: "uploading",
    consent_version: input.consentVersion,
    upload_intent_expires_at: expiresAt,
  });

  if (insertError) {
    if (insertError.code === "23514") {
      throw new DiscoveryPhotoError("photo_limit_reached", 409, "You can add up to three photos to a visit");
    }
    console.error("[discovery-photos/upload-intent] insert failed:", insertError.message);
    throw new DiscoveryPhotoError("internal_error", 500, "Photo upload is temporarily unavailable", true);
  }

  return { photoId, bucket: SOURCE_BUCKET, path, expiresAt, expiresInSeconds: UPLOAD_INTENT_TTL_SECONDS };
}

export async function completeDiscoveryPhotoUpload(input: {
  contributionId: string;
  photoId: string;
  userId: string;
}) {
  const admin = createAdminClient();
  const { data: photo, error: fetchError } = await admin
    .from("merchant_visit_photos")
    .select("id, private_source_key, moderation_status")
    .eq("id", input.photoId)
    .eq("contribution_id", input.contributionId)
    .eq("hub_user_id", input.userId)
    .maybeSingle();

  if (fetchError) {
    console.error("[discovery-photos/complete] lookup failed:", fetchError.message);
    throw new DiscoveryPhotoError("internal_error", 500, "Photo upload is temporarily unavailable", true);
  }
  if (!photo) throw new DiscoveryPhotoError("not_found", 404);
  if (["processing", "pending", "approved"].includes(photo.moderation_status)) {
    return { ok: true as const, photoId: input.photoId, status: photo.moderation_status, idempotent: true };
  }
  if (photo.moderation_status !== "uploading") throw new DiscoveryPhotoError("invalid_state", 409);

  const objectDir = photo.private_source_key.split("/").slice(0, -1).join("/");
  const objectName = photo.private_source_key.split("/").at(-1) ?? "";
  const { data: listing, error: listError } = await admin.storage
    .from(SOURCE_BUCKET)
    .list(objectDir, { search: objectName });

  if (listError) {
    console.error("[discovery-photos/complete] storage list failed:", listError.message);
    throw new DiscoveryPhotoError("internal_error", 500, "Photo upload is temporarily unavailable", true);
  }
  if (!listing?.some((object) => object.name === objectName)) {
    throw new DiscoveryPhotoError("upload_not_found", 409);
  }

  const { data: completed, error: completeError } = await admin.rpc("complete_discovery_photo_upload", {
    p_photo_id: input.photoId,
    p_contribution_id: input.contributionId,
    p_hub_user_id: input.userId,
  });
  if (completeError) {
    console.error("[discovery-photos/complete] complete_discovery_photo_upload failed:", completeError.message);
    throw new DiscoveryPhotoError("internal_error", 500, "Photo upload is temporarily unavailable", true);
  }
  const result = Array.isArray(completed) ? completed[0] : completed;
  if (!result?.ok) throw new DiscoveryPhotoError(result?.error_code ?? "invalid_state", 409);

  return {
    ok: true as const,
    photoId: input.photoId,
    status: result.current_state ?? "processing",
    idempotent: result.idempotent === true,
  };
}

export async function withdrawDiscoveryPhoto(input: {
  contributionId: string;
  photoId: string;
  userId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("merchant_visit_photos")
    .update({ moderation_status: "withdrawn", withdrawn_at: new Date().toISOString() })
    .eq("id", input.photoId)
    .eq("contribution_id", input.contributionId)
    .eq("hub_user_id", input.userId)
    .not("moderation_status", "in", "(rejected,withdrawn)")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[discovery-photos/withdraw] update failed:", error.message);
    throw new DiscoveryPhotoError("internal_error", 500, "Photo removal is temporarily unavailable", true);
  }
  if (!data) throw new DiscoveryPhotoError("not_found", 404);
  return { ok: true as const };
}
