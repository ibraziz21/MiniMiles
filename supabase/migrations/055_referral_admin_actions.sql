-- 055_referral_admin_actions.sql
-- Admin action primitives for the referral system (referral-system-spec.md
-- §11.1/§11.2). packages/admin-dashboard reads referral_* tables directly
-- with its own service-role client (same Supabase project as hub-page —
-- confirmed: same SUPABASE_SERVICE_KEY / project ref, admin-dashboard's own
-- sql/ migrations already query other hub-page-owned tables the same way,
-- e.g. order_cancellation_compensations, spend_voucher_templates). This
-- migration lives here (not admin-dashboard's sql/ folder) because it only
-- adds functions on referral_reward_jobs/hub_referrals/referral_program_versions
-- — tables owned by 053_referral_system.sql — no new tables of its own.
--
-- Per spec §11.2 "Admin approval changes job eligibility; it never writes
-- directly to miles_ledger. Manual grants still pass through the same
-- idempotent reward worker" — every function below only ever moves a job
-- back into the normal claim/release pipeline (053's claim_referral_reward_
-- jobs/complete_referral_reward_job) or voids/reverses Hub's own
-- bookkeeping; none of them call Platform directly.

-- ── admin_requeue_referral_reward_job ────────────────────────────────────
-- Moves a manual_review job back into the normal pipeline: eligible now, so
-- the next worker pass claims and pays it exactly like any other job.

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

  UPDATE referral_reward_jobs
  SET status = 'eligible', eligible_at = now(), next_retry_at = NULL,
      last_error_code = NULL, last_error_detail = NULL, updated_at = now()
  WHERE id = p_job_id;

  INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, reason_code)
  VALUES (v_job.referral_id, 'admin', 'referral_manual_reviewed', 'manual_review', 'eligible', p_reason);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION admin_requeue_referral_reward_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_requeue_referral_reward_job(uuid, text) TO service_role;

-- ── admin_void_referral_reward_job ───────────────────────────────────────
-- Targeted single-job void (distinct from void_referral_activation_for_
-- reversal, which only ever touches the activation job for a given
-- qualification_reference) — an admin may need to void the signup job too,
-- or void a job that never got a qualification_reference at all.

CREATE OR REPLACE FUNCTION admin_void_referral_reward_job(
  p_job_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job referral_reward_jobs%ROWTYPE;
  v_referral hub_referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status NOT IN ('pending_hold', 'eligible', 'manual_review') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_referral FROM hub_referrals WHERE id = v_job.referral_id FOR UPDATE;

  UPDATE referral_reward_jobs
  SET status = 'voided', voided_at = now(), last_error_code = 'admin_voided', last_error_detail = p_reason,
      updated_at = now()
  WHERE id = p_job_id;

  UPDATE referral_program_versions
  SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles
  WHERE id = v_referral.program_version_id;

  INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
  VALUES (v_referral.id, 'admin', 'referral_reward_voided', p_reason,
          jsonb_build_object('jobId', p_job_id, 'milestone', v_job.milestone));

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION admin_void_referral_reward_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_void_referral_reward_job(uuid, text) TO service_role;

-- ── admin_reverse_referral_reward_job ────────────────────────────────────
-- Reverses an already-released job (confirmed fraud / post-payout dispute
-- an admin identified directly, not via the automated order-cancellation
-- path). Never mutates or deletes the original release row.

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
  SET status = 'reversed', reversed_at = now(), updated_at = now()
  WHERE id = p_job_id;

  UPDATE referral_program_versions
  SET released_budget_miles = released_budget_miles - v_job.amount_miles
  WHERE id = v_referral.program_version_id;

  INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
  VALUES (v_referral.id, 'admin', 'referral_reward_reversed', p_reason,
          jsonb_build_object('jobId', p_job_id, 'milestone', v_job.milestone));

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION admin_reverse_referral_reward_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reverse_referral_reward_job(uuid, text) TO service_role;

-- ── admin_reject_referral ────────────────────────────────────────────────
-- Rejects the whole referral (e.g. fraud confirmed before/after
-- activation): voids every un-released job, leaves any already-released
-- job's history untouched (its Miles were already earned and paid; use
-- admin_reverse_referral_reward_job separately if that specific credit must
-- also be clawed back).

CREATE OR REPLACE FUNCTION admin_reject_referral(
  p_referral_id uuid,
  p_reason text
) RETURNS TABLE(ok boolean, voided_jobs integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral hub_referrals%ROWTYPE;
  v_job referral_reward_jobs%ROWTYPE;
  v_voided integer := 0;
BEGIN
  SELECT * INTO v_referral FROM hub_referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND OR v_referral.status = 'complete' THEN
    RETURN QUERY SELECT false, 0; RETURN;
  END IF;

  FOR v_job IN
    SELECT * FROM referral_reward_jobs WHERE referral_id = p_referral_id FOR UPDATE
  LOOP
    IF v_job.status IN ('pending_hold', 'eligible', 'manual_review') THEN
      UPDATE referral_reward_jobs
      SET status = 'voided', voided_at = now(), last_error_code = 'admin_rejected', last_error_detail = p_reason,
          updated_at = now()
      WHERE id = v_job.id;

      UPDATE referral_program_versions
      SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles
      WHERE id = v_referral.program_version_id;

      v_voided := v_voided + 1;
    END IF;
  END LOOP;

  UPDATE hub_referrals SET status = 'rejected', rejection_reason_code = p_reason, updated_at = now()
  WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, reason_code, metadata)
  VALUES (p_referral_id, 'admin', 'referral_rejected', v_referral.status, 'rejected', p_reason,
          jsonb_build_object('voidedJobs', v_voided));

  RETURN QUERY SELECT true, v_voided;
END;
$$;

REVOKE ALL ON FUNCTION admin_reject_referral(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_referral(uuid, text) TO service_role;

-- ── admin_publish_referral_program_version ───────────────────────────────
-- Draft -> active. The partial unique index on (status) WHERE status =
-- 'active' (053) makes "at most one active version" atomic here — a
-- concurrent publish attempt simply loses the unique_violation race.

CREATE OR REPLACE FUNCTION admin_publish_referral_program_version(p_version_id uuid)
RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_version referral_program_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_version FROM referral_program_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'NOT_FOUND'; RETURN;
  END IF;
  IF v_version.status <> 'draft' THEN
    RETURN QUERY SELECT false, 'NOT_DRAFT'; RETURN;
  END IF;

  BEGIN
    UPDATE referral_program_versions
    SET status = 'active', published_at = now()
    WHERE id = p_version_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'ANOTHER_VERSION_ACTIVE'; RETURN;
  END;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION admin_publish_referral_program_version(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_publish_referral_program_version(uuid) TO service_role;

-- ── admin_pause_referral_program_version ─────────────────────────────────
-- Emergency stop — active -> paused only. Does not cancel already
-- earned/released rewards (§11.1); accept_referral_click and
-- create_or_get_hub_pass_with_referral both require status = 'active', so a
-- paused version simply stops taking new clicks/bindings immediately.

CREATE OR REPLACE FUNCTION admin_pause_referral_program_version(p_version_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE referral_program_versions SET status = 'paused' WHERE id = p_version_id AND status = 'active';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION admin_pause_referral_program_version(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_pause_referral_program_version(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
