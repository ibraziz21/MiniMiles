-- 052_hub_quest_event_worker_leases.sql
-- Hub Quest Event Delivery, Slice B (hub-quest-event-delivery-spec.md §5) —
-- lease-safe claim/complete for the internal_event_jobs outbox
-- (044_internal_event_outbox.sql) so packages/backend's new
-- HubQuestEventWorker and the existing Vercel recovery route
-- (process-internal-event-jobs) share one claim contract: a crashed
-- claimant's lease expires and the row is reclaimed instead of being
-- stranded in 'processing' forever.

ALTER TABLE internal_event_jobs
  ADD COLUMN IF NOT EXISTS claimed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by       text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code  text;

CREATE INDEX IF NOT EXISTS idx_internal_event_jobs_lease_expiry
  ON internal_event_jobs (lease_expires_at) WHERE status = 'processing';

-- ── claim_internal_event_jobs — replaces the 044 single-arg version ─────────
-- Claims, oldest-first: pending rows whose next_retry_at is null/due, and
-- processing rows whose lease has expired or was never set (pre-migration
-- rows). last_error/last_error_code are intentionally left untouched here —
-- spec §5.1 "clear a stale last_error only after successful release, not at
-- claim time" — so an operator inspecting a job mid-retry still sees the
-- prior failure rather than a blank slate.

DROP FUNCTION IF EXISTS claim_internal_event_jobs(integer);

CREATE OR REPLACE FUNCTION claim_internal_event_jobs(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
) RETURNS SETOF internal_event_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE internal_event_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      claimed_at = now(),
      claimed_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM internal_event_jobs
    WHERE (
      (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
    )
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_internal_event_jobs(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_internal_event_jobs(integer, text, integer) TO service_role;

-- ── complete_internal_event_job — replaces the 044 3-arg version ────────────
-- Succeeds only for the worker instance that currently holds a live lease on
-- this row (spec §5.2) — a straggler completing after its lease already
-- expired and got reclaimed by someone else must not clobber the new
-- claimant's work. Returns false (rather than raising) when that guard
-- fails, so the caller logs a "lost my lease" warning instead of treating it
-- as a delivery error.

DROP FUNCTION IF EXISTS complete_internal_event_job(uuid, boolean, text);

CREATE OR REPLACE FUNCTION complete_internal_event_job(
  p_job_id uuid,
  p_worker_id text,
  p_ok boolean,
  p_retryable boolean,
  p_error_code text DEFAULT NULL,
  p_error_detail text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job internal_event_jobs%ROWTYPE;
  v_max_attempts constant integer := 10;
  v_detail text := left(coalesce(p_error_detail, ''), 500);
BEGIN
  SELECT * INTO v_job FROM internal_event_jobs
  WHERE id = p_job_id
    AND claimed_by = p_worker_id
    AND status = 'processing'
    AND lease_expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_ok THEN
    UPDATE internal_event_jobs
    SET status = 'released',
        released_at = now(),
        claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL,
        last_error = NULL, last_error_code = NULL,
        updated_at = now()
    WHERE id = p_job_id;
    RETURN true;
  END IF;

  IF p_retryable AND v_job.attempts < v_max_attempts THEN
    UPDATE internal_event_jobs
    SET status = 'pending',
        next_retry_at = now()
          + (LEAST(v_job.attempts, 6) * interval '5 minutes')
          + (random() * interval '30 seconds'),
        last_error = v_detail,
        last_error_code = p_error_code,
        claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL,
        updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE internal_event_jobs
    SET status = 'failed',
        failed_at = now(),
        last_error = v_detail,
        last_error_code = p_error_code,
        claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL,
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION complete_internal_event_job(uuid, text, boolean, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_internal_event_job(uuid, text, boolean, boolean, text, text) TO service_role;

-- ── Operator-only replay ─────────────────────────────────────────────────────
-- Resets explicitly-identified failed rows to pending so the worker retries
-- them, and records who/why in a small audit table (spec §5.3). Deliberately
-- no "replay all" endpoint on top of this — an operator must name job IDs.
-- Idempotency key, identities and metadata are never touched.

CREATE TABLE IF NOT EXISTS internal_event_job_replays (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        NOT NULL REFERENCES internal_event_jobs(id) ON DELETE CASCADE,
  reason      text        NOT NULL,
  actor       text        NOT NULL,
  replayed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE internal_event_job_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal_event_job_replays FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON internal_event_job_replays TO service_role;

CREATE OR REPLACE FUNCTION replay_internal_event_jobs(
  p_job_ids uuid[],
  p_reason text,
  p_actor text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM internal_event_jobs
  WHERE id = ANY(p_job_ids) AND status = 'failed'
  FOR UPDATE;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE internal_event_jobs
  SET status = 'pending',
      failed_at = NULL,
      next_retry_at = now(),
      updated_at = now()
  WHERE id = ANY(v_ids);

  INSERT INTO internal_event_job_replays (job_id, reason, actor)
  SELECT unnest(v_ids), p_reason, p_actor;

  RETURN array_length(v_ids, 1);
END;
$$;

REVOKE ALL ON FUNCTION replay_internal_event_jobs(uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replay_internal_event_jobs(uuid[], text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
