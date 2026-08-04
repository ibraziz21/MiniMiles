-- 056_referral_reversal_delivery.sql
-- Wires Hub's reversal bookkeeping to Akiba-Platform's now-confirmed
-- POST /api/v1/referrals/reward/reverse contract.
--
-- Gap this closes: void_referral_activation_for_reversal (053) and
-- admin_reverse_referral_reward_job (055) previously marked a released job
-- 'reversed' directly — a terminal state with no worker ever having called
-- Platform to actually create the debit. There was no place in the state
-- machine for "Hub decided to reverse this, Platform hasn't confirmed the
-- debit yet" — a worker crash between the decision and the (nonexistent)
-- delivery call would have silently lost the reversal. This migration adds
-- that intermediate state and a delivery pipeline for it, mirroring the
-- original credit pipeline's accrue-then-confirm shape exactly.
--
-- Direction disambiguation without a new "direction" column: a credit job
-- always has released_at IS NULL until it succeeds; a reversal job is, by
-- definition, one that already has released_at IS NOT NULL (it was
-- released, now being reversed). Every function below that touches
-- 'processing'/'manual_review' rows partitions on released_at instead of
-- tracking direction separately — one signal, already on the row, always
-- correct.

-- ── referral_reward_jobs: new intermediate status + a place for the debit's
--    own ledger reference (distinct from platform_reference, which is the
--    original credit's) ─────────────────────────────────────────────────

ALTER TABLE referral_reward_jobs
  ADD COLUMN IF NOT EXISTS reversal_platform_reference text;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'referral_reward_jobs'
    AND con.contype = 'c'
    AND att.attname = 'status';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE referral_reward_jobs DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE referral_reward_jobs ADD CONSTRAINT referral_reward_jobs_status_check
  CHECK (status IN (
    'pending_hold', 'eligible', 'processing', 'released',
    'manual_review', 'voided', 'reversal_pending', 'reversed'
  ));

-- ── void_referral_activation_for_reversal (053): released -> reversal_pending,
--    not 'reversed' directly. Budget stays reserved-as-released until
--    Platform confirms — matches how the original credit only moves
--    reserved->released in complete_referral_reward_job on confirmation,
--    never at "decided eligible" time. ──────────────────────────────────

CREATE OR REPLACE FUNCTION void_referral_activation_for_reversal(
  p_qualification_reference text,
  p_reason text
) RETURNS TABLE(ok boolean, voided_jobs integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral hub_referrals%ROWTYPE;
  v_job      referral_reward_jobs%ROWTYPE;
  v_voided   integer := 0;
BEGIN
  SELECT * INTO v_referral FROM hub_referrals
  WHERE qualification_reference = p_qualification_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0; RETURN;
  END IF;

  FOR v_job IN
    SELECT * FROM referral_reward_jobs
    WHERE referral_id = v_referral.id AND milestone = 'activation'
    FOR UPDATE
  LOOP
    IF v_job.status IN ('pending_hold', 'eligible', 'manual_review') THEN
      UPDATE referral_reward_jobs
      SET status = 'voided', voided_at = now(),
          last_error_code = 'reversed', last_error_detail = p_reason, updated_at = now()
      WHERE id = v_job.id;

      UPDATE referral_program_versions
      SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles
      WHERE id = v_referral.program_version_id;

      INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
      VALUES (
        v_referral.id, 'system', 'referral_reward_voided', p_reason,
        jsonb_build_object('jobId', v_job.id, 'qualificationReference', p_qualification_reference)
      );

      v_voided := v_voided + 1;

    ELSIF v_job.status = 'released' THEN
      UPDATE referral_reward_jobs
      SET status = 'reversal_pending', next_retry_at = NULL,
          last_error_code = 'reversal_requested', last_error_detail = p_reason, updated_at = now()
      WHERE id = v_job.id;

      INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
      VALUES (
        v_referral.id, 'system', 'referral_reward_reversal_pending', p_reason,
        jsonb_build_object('jobId', v_job.id, 'qualificationReference', p_qualification_reference)
      );

      v_voided := v_voided + 1;
    END IF;
  END LOOP;

  IF v_voided > 0 AND v_referral.status <> 'complete' THEN
    UPDATE hub_referrals SET status = 'rejected', rejection_reason_code = p_reason, updated_at = now()
    WHERE id = v_referral.id;
  END IF;

  RETURN QUERY SELECT true, v_voided;
END;
$$;

-- ── admin_reverse_referral_reward_job (055): same change ─────────────────

CREATE OR REPLACE FUNCTION admin_reverse_referral_reward_job(
  p_job_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job referral_reward_jobs%ROWTYPE;
  v_referral hub_referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'released' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_referral FROM hub_referrals WHERE id = v_job.referral_id FOR UPDATE;

  UPDATE referral_reward_jobs
  SET status = 'reversal_pending', next_retry_at = NULL,
      last_error_code = 'reversal_requested', last_error_detail = p_reason, updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
  VALUES (v_referral.id, 'admin', 'referral_reward_reversal_pending', p_reason,
          jsonb_build_object('jobId', p_job_id, 'milestone', v_job.milestone));

  RETURN true;
END;
$$;

-- ── claim_referral_reward_jobs (053): only ever reclaims stale CREDIT
--    'processing' rows (released_at IS NULL) — a stale reversal-in-flight
--    row must never re-enter the credit pipeline. ─────────────────────────

CREATE OR REPLACE FUNCTION claim_referral_reward_jobs(
  p_limit          integer,
  p_worker_id      text,
  p_lease_seconds  integer
) RETURNS SETOF referral_reward_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT referral_flag_enabled('release_rewards') THEN
    RETURN;
  END IF;

  UPDATE referral_reward_jobs j
  SET status = 'manual_review', updated_at = now()
  WHERE j.status IN ('pending_hold', 'eligible')
    AND j.eligible_at <= now()
    AND EXISTS (
      SELECT 1 FROM hub_user_risk_flags f
      WHERE f.hub_user_id = j.recipient_user_id AND f.is_active
        AND f.flag_type IN ('blacklisted', 'rewards_disabled')
    );

  RETURN QUERY
  UPDATE referral_reward_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM referral_reward_jobs
    WHERE (
      (status IN ('pending_hold', 'eligible') AND eligible_at <= now()
        AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR (status = 'processing' AND released_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
    )
    ORDER BY eligible_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ── complete_referral_reward_job (053): restricted to credit-direction rows
--    (released_at IS NULL) so it can never complete a reversal claim that
--    happens to also be 'processing' under the same worker id. ───────────

CREATE OR REPLACE FUNCTION complete_referral_reward_job(
  p_job_id             uuid,
  p_worker_id          text,
  p_ok                 boolean,
  p_retryable          boolean,
  p_platform_reference text DEFAULT NULL,
  p_error_code         text DEFAULT NULL,
  p_error_detail       text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job            referral_reward_jobs%ROWTYPE;
  v_referral       hub_referrals%ROWTYPE;
  v_max_attempts   constant integer := 10;
  v_detail         text := left(coalesce(p_error_detail, ''), 500);
  v_both_released  boolean;
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id AND status = 'processing'
    AND lease_expires_at > now() AND released_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_ok THEN
    UPDATE referral_reward_jobs
    SET status = 'released', released_at = now(), platform_reference = p_platform_reference,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = NULL, last_error_detail = NULL, updated_at = now()
    WHERE id = p_job_id;

    SELECT * INTO v_referral FROM hub_referrals WHERE id = v_job.referral_id FOR UPDATE;

    UPDATE referral_program_versions
    SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles,
        released_budget_miles = released_budget_miles + v_job.amount_miles
    WHERE id = v_referral.program_version_id;

    SELECT NOT EXISTS (
      SELECT 1 FROM referral_reward_jobs WHERE referral_id = v_referral.id AND status <> 'released'
    ) INTO v_both_released;

    UPDATE hub_referrals
    SET status = CASE WHEN v_both_released THEN 'complete' ELSE status END, updated_at = now()
    WHERE id = v_referral.id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, to_state, metadata)
    VALUES (
      v_referral.id, 'worker',
      CASE WHEN v_job.milestone = 'signup' THEN 'referral_signup_reward_released' ELSE 'referral_activation_reward_released' END,
      CASE WHEN v_both_released THEN 'complete' ELSE v_referral.status END,
      jsonb_build_object('jobId', v_job.id, 'amountMiles', v_job.amount_miles, 'platformReference', p_platform_reference)
    );

    RETURN true;
  END IF;

  IF p_retryable AND v_job.attempts < v_max_attempts THEN
    UPDATE referral_reward_jobs
    SET status = 'eligible',
        next_retry_at = now() + (LEAST(v_job.attempts, 6) * interval '5 minutes') + (random() * interval '30 seconds'),
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE referral_reward_jobs
    SET status = 'manual_review',
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
    VALUES (
      v_job.referral_id, 'worker', 'referral_manual_reviewed', p_error_code,
      jsonb_build_object('jobId', v_job.id, 'reason', 'max_attempts_exceeded')
    );
  END IF;

  RETURN true;
END;
$$;

-- ── claim_referral_reversal_jobs / complete_referral_reversal_job ────────
-- Delivery pipeline for reversal_pending jobs, same lease shape as the
-- credit pipeline. Never touches miles_ledger directly — it only calls
-- Platform's reversal endpoint and records what came back.

CREATE OR REPLACE FUNCTION claim_referral_reversal_jobs(
  p_limit          integer,
  p_worker_id      text,
  p_lease_seconds  integer
) RETURNS SETOF referral_reward_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT referral_flag_enabled('release_rewards') THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE referral_reward_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM referral_reward_jobs
    WHERE (
      (status = 'reversal_pending' AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR (status = 'processing' AND released_at IS NOT NULL AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
    )
    ORDER BY updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_referral_reversal_jobs(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_referral_reversal_jobs(integer, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION complete_referral_reversal_job(
  p_job_id                     uuid,
  p_worker_id                  text,
  p_ok                         boolean,
  p_retryable                  boolean,
  p_reversal_platform_reference text DEFAULT NULL,
  p_error_code                 text DEFAULT NULL,
  p_error_detail               text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job           referral_reward_jobs%ROWTYPE;
  v_referral      hub_referrals%ROWTYPE;
  v_max_attempts  constant integer := 10;
  v_detail        text := left(coalesce(p_error_detail, ''), 500);
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id AND status = 'processing'
    AND lease_expires_at > now() AND released_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_ok THEN
    UPDATE referral_reward_jobs
    SET status = 'reversed', reversed_at = now(), reversal_platform_reference = p_reversal_platform_reference,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = NULL, last_error_detail = NULL, updated_at = now()
    WHERE id = p_job_id;

    SELECT * INTO v_referral FROM hub_referrals WHERE id = v_job.referral_id FOR UPDATE;

    -- Confirmation-gated, matching the credit path: released_budget_miles
    -- only moves once Platform has actually confirmed the debit.
    UPDATE referral_program_versions
    SET released_budget_miles = released_budget_miles - v_job.amount_miles
    WHERE id = v_referral.program_version_id;

    -- A confirmed reversal always means a previously-*paid* reward is now
    -- being clawed back — reaching this function requires released_at IS
    -- NOT NULL, so this is never the pre-release void path. Route to
    -- manual_review (not 'rejected'): reversing e.g. the activation reward
    -- must not silently imply the referral's other, still-legitimately-paid
    -- milestone was also fraudulent — an admin decides that, this just
    -- flags it. Without this, a referral that had already reached
    -- 'complete' stayed 'complete' after its reward was reversed, which is
    -- what the dashboard and reconciliation views were reading from.
    UPDATE hub_referrals
    SET status = 'manual_review',
        rejection_reason_code = COALESCE(v_job.last_error_detail, 'reward_reversed'),
        updated_at = now()
    WHERE id = v_referral.id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, metadata)
    VALUES (
      v_referral.id, 'worker', 'referral_reward_reversed', v_referral.status, 'manual_review',
      jsonb_build_object(
        'jobId', v_job.id, 'amountMiles', v_job.amount_miles,
        'reversalPlatformReference', p_reversal_platform_reference
      )
    );

    RETURN true;
  END IF;

  IF p_retryable AND v_job.attempts < v_max_attempts THEN
    UPDATE referral_reward_jobs
    SET status = 'reversal_pending',
        next_retry_at = now() + (LEAST(v_job.attempts, 6) * interval '5 minutes') + (random() * interval '30 seconds'),
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE referral_reward_jobs
    SET status = 'manual_review',
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
    VALUES (
      v_job.referral_id, 'worker', 'referral_manual_reviewed', p_error_code,
      jsonb_build_object('jobId', v_job.id, 'reason', 'reversal_max_attempts_exceeded')
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION complete_referral_reversal_job(uuid, text, boolean, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_referral_reversal_job(uuid, text, boolean, boolean, text, text, text) TO service_role;

-- ── release_expired_referral_reward_leases (053): route the reclaim by
--    released_at instead of unconditionally sending everything back to
--    'eligible' — that would have wrongly re-entered a stuck reversal into
--    the credit pipeline. ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION release_expired_referral_reward_leases()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_credit_count   integer;
  v_reversal_count integer;
BEGIN
  UPDATE referral_reward_jobs
  SET status = 'eligible', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE status = 'processing' AND released_at IS NULL AND lease_expires_at <= now();
  GET DIAGNOSTICS v_credit_count = ROW_COUNT;

  UPDATE referral_reward_jobs
  SET status = 'reversal_pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE status = 'processing' AND released_at IS NOT NULL AND lease_expires_at <= now();
  GET DIAGNOSTICS v_reversal_count = ROW_COUNT;

  RETURN v_credit_count + v_reversal_count;
END;
$$;

-- ── admin_requeue_referral_reward_job (055): route back to the correct
--    pending status depending on whether this manual_review job is a stuck
--    credit or a stuck reversal. ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_requeue_referral_reward_job(
  p_job_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job referral_reward_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'manual_review' THEN
    RETURN false;
  END IF;

  IF v_job.released_at IS NULL THEN
    UPDATE referral_reward_jobs
    SET status = 'eligible', eligible_at = now(), next_retry_at = NULL,
        last_error_code = NULL, last_error_detail = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE referral_reward_jobs
    SET status = 'reversal_pending', next_retry_at = NULL,
        last_error_code = NULL, last_error_detail = NULL, updated_at = now()
    WHERE id = p_job_id;
  END IF;

  INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, reason_code)
  VALUES (
    v_job.referral_id, 'admin', 'referral_manual_reviewed', 'manual_review',
    CASE WHEN v_job.released_at IS NULL THEN 'eligible' ELSE 'reversal_pending' END,
    p_reason
  );

  RETURN true;
END;
$$;

NOTIFY pgrst, 'reload schema';
