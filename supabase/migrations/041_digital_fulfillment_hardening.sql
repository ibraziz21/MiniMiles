-- Digital fulfilment hardening (order-lifecycle-completion-spec.md §4.2,
-- paid-order-recovery-spec.md-adjacent Phase 5 gate: "successful fulfilment
-- completes once; three failures produce one cancellation and one refund").
--
-- Two changes:
--
-- 1. complete_fulfillment_job now cascades delivered -> received -> completed
--    itself, inside the same atomic Postgres function, instead of relying on
--    admin-dashboard firing an unawaited ("fire-and-forget") HTTP webhook to
--    hub-page's /api/internal/complete-digital-order afterward. That webhook
--    had no retry and no durability -- if it failed or admin-dashboard's
--    process died mid-request, the order silently stayed at 'delivered'
--    forever with its reward never released. Digital delivery IS receipt
--    (no separate customer confirmation makes sense), so cascading the whole
--    thing inside the DB transaction that already fires when ops marks a job
--    delivered removes the failure mode by removing the network hop
--    entirely -- "a durable database transition" per the spec's own wording,
--    not a hardened webhook. The reward job this makes eligible is picked up
--    by the same scheduled worker (process_reward_jobs) regardless of which
--    app triggered completion, so no cross-app call is needed for that
--    either. hub-page's complete-digital-order route becomes unused; removed
--    separately in application code.
--
-- 2. fail_fulfillment_job enforces a 3-attempt cap. The first two failures
--    behave as before (fulfil_failed, awaiting manual ops retry). The third
--    automatically cascades fulfil_failed -> cancelled, which reuses
--    advance_order_status's existing cancellation compensation atomically:
--    refund row, voucher reinstatement, settlement adjustment, customer
--    notification. No separate refund/compensation logic needed here.

CREATE OR REPLACE FUNCTION complete_fulfillment_job(
  p_job_id       uuid,
  p_provider_ref text
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job     record;
  v_advance record;
BEGIN
  SELECT * INTO v_job FROM fulfillment_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'JOB_NOT_FOUND'; RETURN;
  END IF;
  IF v_job.status = 'delivered' THEN
    RETURN QUERY SELECT true, ''::text; RETURN;
  END IF;

  -- The ops operator stands in for the (future) automated provider adapter,
  -- so this transition is recorded as 'system', same actor an adapter would use.
  SELECT * INTO v_advance FROM advance_order_status(
    v_job.order_id, 'delivered', 'system',
    jsonb_build_object('reason', 'digital_fulfillment_delivered', 'provider_ref', p_provider_ref)
  );
  IF NOT v_advance.ok THEN
    RETURN QUERY SELECT false, v_advance.error_code; RETURN;
  END IF;

  UPDATE fulfillment_jobs
  SET status = 'delivered', provider_ref = p_provider_ref, last_error = NULL, updated_at = now()
  WHERE id = p_job_id;

  -- Digital delivery is receipt -- cascade straight through, atomically, in
  -- this same transaction. Each step's own idempotency (advance_order_status
  -- checks order_status_transitions; reward eligibility only flips 'pending'
  -- rows) makes this safe even if something upstream retries this call.
  SELECT * INTO v_advance FROM advance_order_status(v_job.order_id, 'received', 'system', '{}'::jsonb);
  IF NOT v_advance.ok THEN
    RETURN QUERY SELECT false, v_advance.error_code; RETURN;
  END IF;

  SELECT * INTO v_advance FROM advance_order_status(v_job.order_id, 'completed', 'system', '{}'::jsonb);
  IF NOT v_advance.ok THEN
    RETURN QUERY SELECT false, v_advance.error_code; RETURN;
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

-- ── Ops action: mark failed, auto-cancel after 3 attempts ──────────────────
CREATE OR REPLACE FUNCTION fail_fulfillment_job(
  p_job_id uuid,
  p_error  text
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job       record;
  v_advance   record;
  v_attempts  integer;
BEGIN
  SELECT * INTO v_job FROM fulfillment_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'JOB_NOT_FOUND'; RETURN;
  END IF;

  v_attempts := v_job.attempts + 1;

  SELECT * INTO v_advance FROM advance_order_status(
    v_job.order_id, 'fulfil_failed', 'system',
    jsonb_build_object('reason', 'digital_fulfillment_failed', 'error', p_error, 'attempt', v_attempts)
  );
  IF NOT v_advance.ok THEN
    RETURN QUERY SELECT false, v_advance.error_code; RETURN;
  END IF;

  UPDATE fulfillment_jobs
  SET status = 'failed', last_error = p_error, attempts = v_attempts, updated_at = now()
  WHERE id = p_job_id;

  IF v_attempts >= 3 THEN
    -- Exhausted retries: auto-cancel. advance_order_status's cancellation
    -- branch atomically creates the refund row, reinstates the voucher, and
    -- notifies the customer -- all in this same call.
    SELECT * INTO v_advance FROM advance_order_status(
      v_job.order_id, 'cancelled', 'system',
      jsonb_build_object('reason', 'fulfilment_attempts_exhausted', 'error', p_error)
    );
    IF NOT v_advance.ok THEN
      RETURN QUERY SELECT false, v_advance.error_code; RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

-- retry_fulfillment_job is unchanged -- once the 3rd failure auto-cancels
-- the order, its status is 'cancelled', and 'cancelled' -> 'retrying' isn't
-- in order_status_transitions, so a further retry attempt is naturally
-- rejected (INVALID_TRANSITION) without needing an explicit attempts check
-- here too.

NOTIFY pgrst, 'reload schema';
