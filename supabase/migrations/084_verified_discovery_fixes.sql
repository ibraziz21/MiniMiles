-- Fixes for real bugs found in code review of 081/082, applied as a new
-- migration (081/082 already shipped — do not edit deployed migrations):
--
-- 1. submit_discovery_contribution read template_snapshot with camelCase
--    keys (negativeReasonOptions/experienceOptions); to_jsonb() on the
--    templates row produces snake_case, so every negative reason and
--    experience tag was being rejected as "invalid" regardless of what the
--    UI actually offered.
-- 2. submit_discovery_contribution had no idempotency-key support (§11.2
--    requires one); a bare network retry of an identical submit bumped
--    answer_version again instead of being a no-op.
-- 3. create_discovery_contribution_request trusted the caller's
--    hub_user_id/partner_id without checking them against the earning
--    event they claim to belong to, its verification_status/channel, or
--    the merchant's own contributions_enabled setting.
-- 4. create_discovery_contribution_request's "one open request" check
--    didn't account for expiry, so an ignored request blocked every later
--    earning event for that member/merchant forever.
-- 5. complete_photo_processing_job unconditionally moved a photo to
--    'pending' on success, even if the member had withdrawn it (or the
--    contribution) while the worker was mid-run, and never gave the job
--    itself a terminal state after exhausting retries — it kept being
--    reclaimed forever.
-- 6. The private photo bucket had no file_size_limit/allowed_mime_types,
--    so the "size-limited signed intent" the spec requires wasn't actually
--    enforced anywhere.
-- 7. The photo-complete route did its status flip and job enqueue as two
--    separate calls; a failure between them stranded the photo at
--    'processing' with no valid retry path.

-- ── 1+2: submit_discovery_contribution ──────────────────────────────────
ALTER TABLE merchant_discovery_contributions
  ADD COLUMN IF NOT EXISTS last_idempotency_key text;

DROP FUNCTION IF EXISTS submit_discovery_contribution(
  uuid, uuid, boolean, text, smallint, boolean, text[], jsonb
);

CREATE OR REPLACE FUNCTION submit_discovery_contribution(
  p_request_id             uuid,
  p_hub_user_id            uuid,
  p_would_recommend        boolean,
  p_negative_reason_id     text,
  p_party_size             smallint,
  p_party_size_is_six_plus boolean,
  p_experience_option_ids  text[],
  p_items                  jsonb, -- [{clientItemKey, rawLabel, source, isRecommended}, ...]
  p_idempotency_key        text DEFAULT NULL
) RETURNS TABLE(ok boolean, contribution_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request                discovery_contribution_requests;
  v_existing_contribution_id uuid;
  v_existing_idem_key      text;
  v_allowed_experience_ids text[];
  v_item                   jsonb;
  v_item_count             integer;
  v_recommended_count      integer;
  v_contribution_id        uuid;
  v_mention_id             uuid;
BEGIN
  SELECT * INTO v_request FROM discovery_contribution_requests
  WHERE id = p_request_id AND hub_user_id = p_hub_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent replay: a retry carrying the exact key already recorded on
  -- this request's contribution succeeds without reprocessing or bumping
  -- answer_version again — even if the request has since expired, since
  -- the submission it's confirming already genuinely happened.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, last_idempotency_key INTO v_existing_contribution_id, v_existing_idem_key
    FROM merchant_discovery_contributions WHERE request_id = p_request_id;
    IF v_existing_contribution_id IS NOT NULL AND v_existing_idem_key = p_idempotency_key THEN
      RETURN QUERY SELECT true, v_existing_contribution_id;
      RETURN;
    END IF;
  END IF;

  IF v_request.expires_at < now() THEN
    IF v_request.state = 'open' THEN
      UPDATE discovery_contribution_requests SET state = 'expired' WHERE id = p_request_id;
    END IF;
    RAISE EXCEPTION 'expired' USING ERRCODE = '55000';
  END IF;

  IF v_request.state NOT IN ('open', 'submitted') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;

  IF p_party_size IS NOT NULL AND p_party_size_is_six_plus THEN
    RAISE EXCEPTION 'invalid_party_size' USING ERRCODE = '23514';
  END IF;

  -- template_snapshot is to_jsonb() of the templates row — snake_case
  -- column names, not the TS type's camelCase.
  IF p_negative_reason_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_request.template_snapshot->'negative_reason_options', '[]'::jsonb)) AS opt
    WHERE opt->>'id' = p_negative_reason_id
  ) THEN
    RAISE EXCEPTION 'invalid_negative_reason' USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(opt->>'id') INTO v_allowed_experience_ids
  FROM jsonb_array_elements(COALESCE(v_request.template_snapshot->'experience_options', '[]'::jsonb)) AS opt;

  IF p_experience_option_ids IS NOT NULL AND array_length(p_experience_option_ids, 1) IS NOT NULL THEN
    IF array_length(p_experience_option_ids, 1) > 3 THEN
      RAISE EXCEPTION 'too_many_experience_options' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(p_experience_option_ids) AS opt_id
      WHERE opt_id <> ALL (COALESCE(v_allowed_experience_ids, ARRAY[]::text[]))
    ) THEN
      RAISE EXCEPTION 'invalid_experience_option' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_item_count := COALESCE(jsonb_array_length(p_items), 0);
  IF v_item_count > 4 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO v_recommended_count
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item
  WHERE COALESCE((item->>'isRecommended')::boolean, false);

  IF v_recommended_count > 3 THEN
    RAISE EXCEPTION 'too_many_recommended_items' USING ERRCODE = '23514';
  END IF;

  INSERT INTO merchant_discovery_contributions (
    request_id, hub_user_id, partner_id,
    would_recommend, negative_reason_id,
    party_size, party_size_is_six_plus, experience_option_ids,
    last_idempotency_key
  ) VALUES (
    p_request_id, p_hub_user_id, v_request.partner_id,
    p_would_recommend, p_negative_reason_id,
    p_party_size, p_party_size_is_six_plus, COALESCE(p_experience_option_ids, '{}'),
    p_idempotency_key
  )
  ON CONFLICT (request_id) DO UPDATE SET
    would_recommend = EXCLUDED.would_recommend,
    negative_reason_id = EXCLUDED.negative_reason_id,
    party_size = EXCLUDED.party_size,
    party_size_is_six_plus = EXCLUDED.party_size_is_six_plus,
    experience_option_ids = EXCLUDED.experience_option_ids,
    last_idempotency_key = EXCLUDED.last_idempotency_key,
    answer_version = merchant_discovery_contributions.answer_version + 1,
    withdrawn_at = NULL,
    updated_at = now()
  RETURNING id INTO v_contribution_id;

  DELETE FROM merchant_discovery_contribution_items WHERE contribution_id = v_contribution_id;

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_mention_id := record_discovery_item_mention(
        p_request_id,
        v_item->>'clientItemKey',
        p_hub_user_id,
        v_request.partner_id,
        v_item->>'rawLabel',
        COALESCE(v_item->>'source', 'customer_input')
      );

      INSERT INTO merchant_discovery_contribution_items (contribution_id, item_mention_id, is_recommended)
      VALUES (v_contribution_id, v_mention_id, COALESCE((v_item->>'isRecommended')::boolean, false));
    END LOOP;
  END IF;

  UPDATE discovery_contribution_requests
  SET state = 'submitted', submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_request_id;

  RETURN QUERY SELECT true, v_contribution_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_discovery_contribution(uuid, uuid, boolean, text, smallint, boolean, text[], jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_discovery_contribution(uuid, uuid, boolean, text, smallint, boolean, text[], jsonb, text)
  TO service_role;

-- ── 3+4: create_discovery_contribution_request ──────────────────────────
-- Same signature as 081 — no DROP needed, CREATE OR REPLACE is enough.
CREATE OR REPLACE FUNCTION create_discovery_contribution_request(
  p_earning_event_id uuid,
  p_hub_user_id      uuid,
  p_partner_id       uuid
) RETURNS TABLE(ok boolean, request_id uuid, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_template_id       uuid;
  v_template_version  integer;
  v_template_snapshot jsonb;
  v_request_id        uuid;
  v_occurred_at       timestamptz;
  v_earning_event     verified_earning_events;
BEGIN
  -- Idempotent retry of the same earning event always succeeds, regardless
  -- of anything checked below.
  SELECT id INTO v_request_id FROM discovery_contribution_requests
  WHERE earning_event_id = p_earning_event_id;
  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_request_id, 'already_exists'::text;
    RETURN;
  END IF;

  -- The caller's hub_user_id/partner_id are never trusted on their own —
  -- they must match the actual earning event, which must itself be an
  -- active, in-store record (§13.3: "Only active authoritative earning
  -- events create eligible contributions").
  SELECT * INTO v_earning_event FROM verified_earning_events WHERE id = p_earning_event_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_not_found'::text;
    RETURN;
  END IF;
  IF v_earning_event.hub_user_id <> p_hub_user_id OR v_earning_event.partner_id <> p_partner_id THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_mismatch'::text;
    RETURN;
  END IF;
  IF v_earning_event.verification_status <> 'active' THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_not_active'::text;
    RETURN;
  END IF;
  IF v_earning_event.channel <> 'in_store' THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_not_in_store'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM merchant_discovery_settings
    WHERE partner_id = p_partner_id AND contributions_enabled
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'contributions_not_enabled'::text;
    RETURN;
  END IF;

  -- Lazily expire a stale 'open' request for this member/merchant before
  -- checking for one — otherwise an ignored request blocks every later
  -- earning event here forever, since nothing else transitions it (reads
  -- just filter on expires_at, they don't write it).
  UPDATE discovery_contribution_requests
  SET state = 'expired'
  WHERE hub_user_id = p_hub_user_id AND partner_id = p_partner_id
    AND state = 'open' AND expires_at < now();

  IF EXISTS (
    SELECT 1 FROM discovery_contribution_requests
    WHERE hub_user_id = p_hub_user_id AND partner_id = p_partner_id AND state = 'open'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'open_request_exists'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM discovery_contribution_requests
    WHERE hub_user_id = p_hub_user_id AND partner_id = p_partner_id
      AND created_at >= now() - interval '14 days'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'cooldown_active'::text;
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*) FROM discovery_contribution_requests
    WHERE hub_user_id = p_hub_user_id AND created_at >= now() - interval '7 days'
  ) >= 2 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'fatigue_limit_reached'::text;
    RETURN;
  END IF;

  v_occurred_at := v_earning_event.occurred_at;

  SELECT id, version, to_jsonb(t) INTO v_template_id, v_template_version, v_template_snapshot
  FROM discovery_question_templates t
  WHERE category_slug IS NULL AND active
  ORDER BY version DESC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'no_active_template'::text;
    RETURN;
  END IF;

  INSERT INTO discovery_contribution_requests (
    earning_event_id, hub_user_id, partner_id,
    template_id, template_version, template_snapshot,
    state, expires_at
  ) VALUES (
    p_earning_event_id, p_hub_user_id, p_partner_id,
    v_template_id, v_template_version, v_template_snapshot,
    'open', COALESCE(v_occurred_at, now()) + interval '14 days'
  )
  RETURNING id INTO v_request_id;

  RETURN QUERY SELECT true, v_request_id, 'created'::text;
END;
$$;

-- ── 5: complete_photo_processing_job ────────────────────────────────────
-- Same signature as 082 — CREATE OR REPLACE only.
CREATE OR REPLACE FUNCTION complete_photo_processing_job(
  p_job_id        uuid,
  p_ok            boolean,
  p_error         text DEFAULT NULL,
  p_thumbnail_key text DEFAULT NULL,
  p_display_key   text DEFAULT NULL,
  p_width         integer DEFAULT NULL,
  p_height        integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts integer;
  v_photo_id uuid;
BEGIN
  SELECT photo_id INTO v_photo_id FROM photo_processing_jobs WHERE id = p_job_id;

  IF p_ok THEN
    UPDATE photo_processing_jobs
    SET status = 'done', last_error = NULL, updated_at = now()
    WHERE id = p_job_id;

    -- Only resurrect a photo that's still actually 'processing' — a member
    -- can withdraw the photo (or its contribution) while the worker is
    -- mid-run, and that withdrawal must stick, not be overwritten back to
    -- 'pending' moderation by a job that started before it.
    UPDATE merchant_visit_photos
    SET moderation_status = 'pending',
        thumbnail_key = p_thumbnail_key,
        display_key = p_display_key,
        width = p_width,
        height = p_height,
        updated_at = now()
    WHERE id = v_photo_id AND moderation_status = 'processing';
  ELSE
    SELECT attempts + 1 INTO v_attempts FROM photo_processing_jobs WHERE id = p_job_id;

    IF v_attempts >= 6 THEN
      -- Terminal — a job left 'pending' forever with a future
      -- next_retry_at just gets reclaimed indefinitely by the next cron
      -- tick once that time passes; it needs an actual end state.
      UPDATE photo_processing_jobs
      SET status = 'failed', attempts = v_attempts, last_error = p_error, updated_at = now()
      WHERE id = p_job_id;

      UPDATE merchant_visit_photos
      SET moderation_status = 'rejected',
          moderation_reason_code = 'processing_failed',
          updated_at = now()
      WHERE id = v_photo_id AND moderation_status = 'processing';
    ELSE
      UPDATE photo_processing_jobs
      SET status = 'pending',
          attempts = v_attempts,
          last_error = p_error,
          next_retry_at = now() + (LEAST(v_attempts, 6) * interval '5 minutes'),
          updated_at = now()
      WHERE id = p_job_id;
    END IF;
  END IF;
END;
$$;

-- ── 6: size/type-limited private photo bucket ───────────────────────────
UPDATE storage.buckets
SET file_size_limit = 10485760, -- 10 MB, per spec §13.2
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
WHERE id = 'discovery-visit-photos';

-- ── 7: atomic upload-complete transition ─────────────────────────────────
-- Replaces the app route's two separate calls (UPDATE then INSERT) with
-- one statement — if the INSERT fails for any reason, the whole call rolls
-- back instead of stranding the photo at 'processing' with no valid retry
-- path (the route only accepts completing from 'uploading').
CREATE OR REPLACE FUNCTION complete_discovery_photo_upload(p_photo_id uuid)
RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE merchant_visit_photos
  SET moderation_status = 'processing'
  WHERE id = p_photo_id AND moderation_status = 'uploading';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO photo_processing_jobs (photo_id) VALUES (p_photo_id);
  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION complete_discovery_photo_upload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_discovery_photo_upload(uuid) TO service_role;
