import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

const SOURCE_BUCKET = "discovery-visit-photos";
const DERIVED_BUCKET = "discovery-visit-photos-derived";
const MAX_DIMENSION = 8000;
const MAX_PIXELS = 40_000_000;
const THUMBNAIL_WIDTH = 480;
const DISPLAY_WIDTH = 1600;

type PhotoProcessingJob = {
  id: string;
  photo_id: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

async function finishFailedJob(admin: AdminClient, jobId: string, error: string) {
  const { error: completionError } = await admin.rpc("complete_photo_processing_job", {
    p_job_id: jobId,
    p_ok: false,
    p_error: error,
  });

  if (completionError) {
    console.error("[process-photo-jobs] failed to record processing failure:", completionError.message);
  }
}

async function processOne(admin: AdminClient, job: PhotoProcessingJob): Promise<boolean> {
  const { data: photo, error: photoError } = await admin
    .from("merchant_visit_photos")
    .select("private_source_key")
    .eq("id", job.photo_id)
    .maybeSingle();

  if (photoError || !photo) {
    await finishFailedJob(admin, job.id, photoError?.message ?? "photo_row_missing");
    return false;
  }

  const { data: download, error: downloadError } = await admin.storage
    .from(SOURCE_BUCKET)
    .download(photo.private_source_key);

  if (downloadError || !download) {
    await finishFailedJob(admin, job.id, downloadError?.message ?? "download_failed");
    return false;
  }

  try {
    const sourceBuffer = Buffer.from(await download.arrayBuffer());
    const pipeline = sharp(sourceBuffer, { failOn: "error" }).rotate();
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      await finishFailedJob(admin, job.id, "dimensions_exceed_limit");
      return false;
    }

    // Re-encoding without withMetadata strips EXIF/GPS. rotate() first bakes
    // the source orientation into the pixels before that metadata is dropped.
    const displayBuffer = await sharp(sourceBuffer, { failOn: "error" })
      .rotate()
      .resize({ width: Math.min(width, DISPLAY_WIDTH), withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const thumbnailBuffer = await sharp(sourceBuffer, { failOn: "error" })
      .rotate()
      .resize({ width: Math.min(width, THUMBNAIL_WIDTH), withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    const displayKey = `${job.photo_id}/display.webp`;
    const thumbnailKey = `${job.photo_id}/thumbnail.webp`;

    const { error: displayUploadError } = await admin.storage
      .from(DERIVED_BUCKET)
      .upload(displayKey, displayBuffer, { contentType: "image/webp", upsert: true });
    if (displayUploadError) throw new Error(`display_upload_failed: ${displayUploadError.message}`);

    const { error: thumbnailUploadError } = await admin.storage
      .from(DERIVED_BUCKET)
      .upload(thumbnailKey, thumbnailBuffer, { contentType: "image/webp", upsert: true });
    if (thumbnailUploadError) throw new Error(`thumbnail_upload_failed: ${thumbnailUploadError.message}`);

    const { error: completionError } = await admin.rpc("complete_photo_processing_job", {
      p_job_id: job.id,
      p_ok: true,
      p_thumbnail_key: thumbnailKey,
      p_display_key: displayKey,
      p_width: width,
      p_height: height,
    });
    if (completionError) throw new Error(`completion_failed: ${completionError.message}`);
    return true;
  } catch (error) {
    await finishFailedJob(admin, job.id, error instanceof Error ? error.message : "processing_failed");
    return false;
  }
}

/**
 * Claims and processes a bounded batch. The completion endpoint calls this
 * immediately so local development and fresh uploads do not depend on a
 * deployment-only cron. The cron remains the durable retry/recovery path.
 */
export async function processPendingPhotoJobs(admin: AdminClient, batchSize = 10) {
  const { data: jobs, error: claimError } = await admin.rpc("claim_photo_processing_jobs", {
    p_limit: batchSize,
  });
  if (claimError) throw new Error(claimError.message);

  const claimed = (jobs ?? []) as PhotoProcessingJob[];
  let succeeded = 0;
  let failed = 0;

  for (const job of claimed) {
    if (await processOne(admin, job)) succeeded++;
    else failed++;
  }

  return { claimed: claimed.length, succeeded, failed };
}
