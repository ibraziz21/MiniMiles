-- A serverless invocation can stop after claiming a photo but before it calls
-- complete_photo_processing_job. Treat `processing` as a renewable lease so
-- those images do not disappear from both the retry worker and moderation.

CREATE OR REPLACE FUNCTION claim_photo_processing_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF photo_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A job that has lost six worker leases is terminal. Keep its photo out of
  -- moderation because no safe, EXIF-stripped derivative was produced.
  UPDATE photo_processing_jobs
  SET status = 'failed',
      attempts = attempts + 1,
      last_error = 'worker_lease_expired',
      updated_at = now()
  WHERE status = 'processing'
    AND updated_at < now() - interval '10 minutes'
    AND attempts >= 5;

  UPDATE merchant_visit_photos AS photo
  SET moderation_status = 'rejected',
      moderation_reason_code = 'processing_failed',
      updated_at = now()
  FROM photo_processing_jobs AS job
  WHERE job.photo_id = photo.id
    AND job.status = 'failed'
    AND job.last_error = 'worker_lease_expired'
    AND photo.moderation_status = 'processing';

  RETURN QUERY
  UPDATE photo_processing_jobs AS job
  SET status = 'processing',
      attempts = job.attempts + CASE WHEN job.status = 'processing' THEN 1 ELSE 0 END,
      last_error = CASE WHEN job.status = 'processing' THEN 'worker_lease_expired' ELSE job.last_error END,
      updated_at = now()
  WHERE job.id IN (
    SELECT candidate.id
    FROM photo_processing_jobs AS candidate
    WHERE (
        candidate.status = 'pending'
        AND (candidate.next_retry_at IS NULL OR candidate.next_retry_at <= now())
      ) OR (
        candidate.status = 'processing'
        AND candidate.updated_at < now() - interval '10 minutes'
        AND candidate.attempts < 5
      )
    ORDER BY candidate.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_photo_processing_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_photo_processing_jobs(integer) TO service_role;
