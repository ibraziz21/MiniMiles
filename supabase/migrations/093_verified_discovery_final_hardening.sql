-- Verified Discovery — final pilot hardening.
-- Makes upload authorization genuinely five-minute/owner-bound, makes
-- completion idempotent and owner-scoped, makes contribution withdrawal
-- atomic, and gives projection jobs a bounded retry/dead-letter lifecycle.

ALTER TABLE merchant_visit_photos
  ADD COLUMN IF NOT EXISTS upload_intent_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_merchant_visit_photos_upload_intent
  ON merchant_visit_photos (hub_user_id, private_source_key, upload_intent_expires_at)
  WHERE moderation_status = 'uploading';

-- Storage policies cannot safely query a table whose RLS is closed to the
-- authenticated role. This deliberately tiny SECURITY DEFINER predicate
-- returns only a boolean and binds the exact object key to its owner and
-- unexpired database intent.
CREATE OR REPLACE FUNCTION can_upload_discovery_visit_photo(
  p_object_name text,
  p_hub_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM merchant_visit_photos p
    WHERE p.private_source_key = p_object_name
      AND p.hub_user_id = p_hub_user_id
      AND p.moderation_status = 'uploading'
      AND p.upload_intent_expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION can_upload_discovery_visit_photo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_upload_discovery_visit_photo(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS discovery_visit_photo_owner_insert ON storage.objects;
CREATE POLICY discovery_visit_photo_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'discovery-visit-photos'
    AND public.can_upload_discovery_visit_photo(name, auth.uid())
  );

-- Remove the original unscoped overload so no caller can transition a photo
-- without proving both contribution and member ownership in the mutation.
DROP FUNCTION IF EXISTS complete_discovery_photo_upload(uuid);

CREATE OR REPLACE FUNCTION complete_discovery_photo_upload(
  p_photo_id uuid,
  p_contribution_id uuid,
  p_hub_user_id uuid
) RETURNS TABLE(ok boolean, current_state text, idempotent boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_photo merchant_visit_photos;
BEGIN
  SELECT * INTO v_photo
  FROM merchant_visit_photos
  WHERE id = p_photo_id
    AND contribution_id = p_contribution_id
    AND hub_user_id = p_hub_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, false, 'not_found'::text;
    RETURN;
  END IF;

  IF v_photo.moderation_status IN ('processing', 'pending', 'approved') THEN
    RETURN QUERY SELECT true, v_photo.moderation_status, true, NULL::text;
    RETURN;
  END IF;

  IF v_photo.moderation_status <> 'uploading' THEN
    RETURN QUERY SELECT false, v_photo.moderation_status, false, 'invalid_state'::text;
    RETURN;
  END IF;

  IF v_photo.upload_intent_expires_at IS NULL OR v_photo.upload_intent_expires_at <= now() THEN
    UPDATE merchant_visit_photos
    SET moderation_status = 'withdrawn', withdrawn_at = now()
    WHERE id = p_photo_id
      AND contribution_id = p_contribution_id
      AND hub_user_id = p_hub_user_id
      AND moderation_status = 'uploading';
    RETURN QUERY SELECT false, 'withdrawn'::text, false, 'upload_intent_expired'::text;
    RETURN;
  END IF;

  UPDATE merchant_visit_photos
  SET moderation_status = 'processing'
  WHERE id = p_photo_id
    AND contribution_id = p_contribution_id
    AND hub_user_id = p_hub_user_id
    AND moderation_status = 'uploading';

  INSERT INTO photo_processing_jobs (photo_id)
  VALUES (p_photo_id)
  ON CONFLICT (photo_id) DO NOTHING;

  RETURN QUERY SELECT true, 'processing'::text, false, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION complete_discovery_photo_upload(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_discovery_photo_upload(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION withdraw_discovery_contribution(
  p_contribution_id uuid,
  p_hub_user_id uuid
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner_id uuid;
BEGIN
  UPDATE merchant_discovery_contributions
  SET withdrawn_at = now()
  WHERE id = p_contribution_id
    AND hub_user_id = p_hub_user_id
    AND withdrawn_at IS NULL
  RETURNING partner_id INTO v_partner_id;

  IF v_partner_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  UPDATE merchant_visit_photos
  SET moderation_status = 'withdrawn', withdrawn_at = now()
  WHERE contribution_id = p_contribution_id
    AND hub_user_id = p_hub_user_id
    AND moderation_status NOT IN ('rejected', 'withdrawn');

  PERFORM enqueue_merchant_discovery_projection_refresh(v_partner_id, 'contribution_withdrawn');
  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION withdraw_discovery_contribution(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION withdraw_discovery_contribution(uuid, uuid) TO service_role;

-- Every execution attempt, including the first, consumes one attempt. Jobs
-- stop being claimable at six and stale leases are terminally failed.
CREATE OR REPLACE FUNCTION claim_merchant_discovery_projection_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF merchant_discovery_projection_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE merchant_discovery_projection_jobs
  SET status = 'failed',
      reason = CASE WHEN status = 'processing' THEN 'worker_lease_expired' ELSE COALESCE(reason, 'attempts_exhausted') END,
      locked_at = NULL,
      updated_at = now()
  WHERE attempts >= 6
    AND (status = 'pending' OR (status = 'processing' AND locked_at < now() - interval '10 minutes'));

  RETURN QUERY
  UPDATE merchant_discovery_projection_jobs AS job
  SET status = 'processing',
      locked_at = now(),
      attempts = job.attempts + 1,
      updated_at = now()
  WHERE job.id IN (
    SELECT candidate.id
    FROM merchant_discovery_projection_jobs AS candidate
    WHERE candidate.attempts < 6
      AND (
        (candidate.status = 'pending' AND (candidate.next_retry_at IS NULL OR candidate.next_retry_at <= now()))
        OR
        (candidate.status = 'processing' AND candidate.locked_at < now() - interval '10 minutes')
      )
    ORDER BY candidate.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_merchant_discovery_projection_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_merchant_discovery_projection_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION process_pending_merchant_discovery_projection_jobs(p_limit integer DEFAULT 25)
RETURNS TABLE(claimed integer, succeeded integer, failed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job merchant_discovery_projection_jobs;
  v_claimed integer := 0;
  v_succeeded integer := 0;
  v_failed integer := 0;
BEGIN
  FOR v_job IN SELECT * FROM claim_merchant_discovery_projection_jobs(p_limit) LOOP
    v_claimed := v_claimed + 1;
    BEGIN
      PERFORM recompute_merchant_discovery_snapshot(v_job.partner_id);
      UPDATE merchant_discovery_projection_jobs
      SET status = 'done', reason = NULL, locked_at = NULL, next_retry_at = NULL, updated_at = now()
      WHERE id = v_job.id;
      v_succeeded := v_succeeded + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE merchant_discovery_projection_jobs
      SET status = CASE WHEN v_job.attempts >= 6 THEN 'failed' ELSE 'pending' END,
          reason = left(SQLERRM, 500),
          locked_at = NULL,
          next_retry_at = CASE
            WHEN v_job.attempts >= 6 THEN NULL
            ELSE now() + (interval '1 minute' * power(2, LEAST(v_job.attempts, 6)))
          END,
          updated_at = now()
      WHERE id = v_job.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT v_claimed, v_succeeded, v_failed;
END;
$$;

REVOKE ALL ON FUNCTION process_pending_merchant_discovery_projection_jobs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_pending_merchant_discovery_projection_jobs(integer)
  TO service_role;

-- A snapshot with an outstanding refresh is deliberately unavailable. This
-- is the fail-closed barrier for aggregate labels/counts after a reversal or
-- suppression: the transition enqueues in the same transaction, so public
-- reads omit the merchant until a successful recompute marks the queue done.
CREATE OR REPLACE FUNCTION get_public_merchant_discovery_snapshots(p_limit integer DEFAULT 20)
RETURNS TABLE (
  partner_id                   uuid,
  public_count_band            text,
  qualified_experience_labels  jsonb,
  qualified_recommended_items  jsonb,
  cover_photo_id               uuid,
  cover_photo_thumbnail_key    text,
  cover_photo_display_key      text,
  rank_score                   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.partner_id,
    s.public_count_band,
    s.qualified_experience_labels,
    s.qualified_recommended_items,
    p.photo_id,
    p.thumbnail_key,
    p.display_key,
    s.rank_score
  FROM merchant_discovery_public_snapshots s
  JOIN eligible_public_merchant_visit_photos(s.partner_id) p ON p.photo_id = s.cover_photo_id
  WHERE s.suppression_reason IS NULL
    AND s.cover_photo_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM merchant_discovery_projection_jobs j
      WHERE j.partner_id = s.partner_id
        AND j.status IN ('pending', 'processing', 'failed')
    )
  ORDER BY s.rank_score DESC, p.approved_at DESC, s.partner_id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

REVOKE ALL ON FUNCTION get_public_merchant_discovery_snapshots(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_merchant_discovery_snapshots(integer) TO service_role;
