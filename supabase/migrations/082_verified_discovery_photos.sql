-- Verified Discovery V1 — Stage 2: first-party visit photos (spec §10.8,
-- §13.2). Source uploads land in a PRIVATE bucket via short-lived signed
-- upload intents (packages/hub-page/src/app/api/me/discovery-contributions),
-- then a scheduled worker (process-photo-jobs) validates, strips EXIF/GPS
-- and writes AVIF/WebP derivatives to a second private bucket. Nothing here
-- is served publicly in this pass — that wiring is Stage 3, once a photo
-- has cleared admin moderation AND public proof rendering itself is
-- approved.

-- ── merchant_visit_photos (§10.8) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_visit_photos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id        uuid NOT NULL REFERENCES merchant_discovery_contributions(id),
  hub_user_id            uuid NOT NULL,
  partner_id             uuid NOT NULL REFERENCES partners(id),
  item_mention_id        uuid REFERENCES merchant_discovery_item_mentions(id),
  private_source_key     text NOT NULL,
  thumbnail_key          text,
  display_key            text,
  width                  integer,
  height                 integer,
  moderation_status      text NOT NULL DEFAULT 'uploading'
                           CHECK (moderation_status IN
                             ('uploading', 'processing', 'pending', 'approved', 'rejected', 'withdrawn')),
  moderation_reason_code text,
  consent_version        text NOT NULL,
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  approved_at             timestamptz,
  withdrawn_at            timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_visit_photos_contribution
  ON merchant_visit_photos (contribution_id);
CREATE INDEX IF NOT EXISTS idx_merchant_visit_photos_moderation
  ON merchant_visit_photos (moderation_status);

DROP TRIGGER IF EXISTS trg_merchant_visit_photos_touch ON merchant_visit_photos;
CREATE TRIGGER trg_merchant_visit_photos_touch
  BEFORE UPDATE ON merchant_visit_photos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE merchant_visit_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_visit_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_visit_photos TO service_role;

-- "At most three active photo rows" per contribution (§10.8) enforced
-- server-side, not just trusted from the API route.
CREATE OR REPLACE FUNCTION enforce_visit_photo_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_active_count integer;
BEGIN
  SELECT COUNT(*) INTO v_active_count
  FROM merchant_visit_photos
  WHERE contribution_id = NEW.contribution_id
    AND moderation_status NOT IN ('rejected', 'withdrawn');
  IF v_active_count >= 3 THEN
    RAISE EXCEPTION 'photo_limit_reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_visit_photo_limit ON merchant_visit_photos;
CREATE TRIGGER trg_enforce_visit_photo_limit
  BEFORE INSERT ON merchant_visit_photos
  FOR EACH ROW EXECUTE FUNCTION enforce_visit_photo_limit();

-- ── photo_processing_jobs ────────────────────────────────────────────────
-- Same durable job-table shape as reward_jobs (040_durable_reward_jobs.sql):
-- a claim RPC with FOR UPDATE SKIP LOCKED so an overlapping cron invocation
-- can't double-process, and a complete RPC that releases on success or
-- re-arms with linear backoff on failure.
CREATE TABLE IF NOT EXISTS photo_processing_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id      uuid NOT NULL UNIQUE REFERENCES merchant_visit_photos(id),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  next_retry_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_processing_jobs_pending
  ON photo_processing_jobs (next_retry_at) WHERE status = 'pending';

ALTER TABLE photo_processing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON photo_processing_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON photo_processing_jobs TO service_role;

CREATE OR REPLACE FUNCTION claim_photo_processing_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF photo_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE photo_processing_jobs
  SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT id FROM photo_processing_jobs
    WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_photo_processing_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_photo_processing_jobs(integer) TO service_role;

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

    -- Processed photos land in `pending` — admin moderation (§13.2) still
    -- gates public eligibility; processing success alone never approves.
    UPDATE merchant_visit_photos
    SET moderation_status = 'pending',
        thumbnail_key = p_thumbnail_key,
        display_key = p_display_key,
        width = p_width,
        height = p_height,
        updated_at = now()
    WHERE id = v_photo_id;
  ELSE
    SELECT attempts + 1 INTO v_attempts FROM photo_processing_jobs WHERE id = p_job_id;
    UPDATE photo_processing_jobs
    SET status = 'pending',
        attempts = v_attempts,
        last_error = p_error,
        next_retry_at = now() + (LEAST(v_attempts, 6) * interval '5 minutes'),
        updated_at = now()
    WHERE id = p_job_id;

    -- After 6 exhausted attempts, stop retrying silently forever and give
    -- the member a terminal state instead of an invisibly stuck upload.
    IF v_attempts >= 6 THEN
      UPDATE merchant_visit_photos
      SET moderation_status = 'rejected',
          moderation_reason_code = 'processing_failed',
          updated_at = now()
      WHERE id = v_photo_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION complete_photo_processing_job(uuid, boolean, text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_photo_processing_job(uuid, boolean, text, text, text, integer, integer)
  TO service_role;

-- ── perform_visit_photo_transition (admin moderation queue) ────────────
CREATE OR REPLACE FUNCTION perform_visit_photo_transition(
  p_photo_id    uuid,
  p_action      text,
  p_reason_code text DEFAULT NULL
) RETURNS TABLE(ok boolean, photo jsonb, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row merchant_visit_photos;
BEGIN
  SELECT * INTO v_row FROM merchant_visit_photos WHERE id = p_photo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;

  IF v_row.moderation_status <> 'pending' THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_transition'::text;
    RETURN;
  END IF;

  IF p_action = 'approve' THEN
    UPDATE merchant_visit_photos
    SET moderation_status = 'approved', approved_at = now(), moderation_reason_code = NULL
    WHERE id = p_photo_id
    RETURNING * INTO v_row;
  ELSIF p_action = 'reject' THEN
    IF p_reason_code IS NULL OR length(trim(p_reason_code)) = 0 THEN
      RETURN QUERY SELECT false, NULL::jsonb, 'reason_required'::text;
      RETURN;
    END IF;
    UPDATE merchant_visit_photos
    SET moderation_status = 'rejected', moderation_reason_code = p_reason_code
    WHERE id = p_photo_id
    RETURNING * INTO v_row;
  ELSE
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_action'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, to_jsonb(v_row), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION perform_visit_photo_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION perform_visit_photo_transition(uuid, text, text)
  TO service_role;

-- ── private storage buckets ──────────────────────────────────────────────
-- Both private. Source uploads never get a public URL; derivatives stay
-- private in this pass too — public serving is Stage 3 work, wired up only
-- once public proof rendering itself is approved.
INSERT INTO storage.buckets (id, name, public)
VALUES ('discovery-visit-photos', 'discovery-visit-photos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('discovery-visit-photos-derived', 'discovery-visit-photos-derived', false)
ON CONFLICT (id) DO NOTHING;
