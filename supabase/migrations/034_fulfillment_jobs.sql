-- Digital fulfilment jobs (order-lifecycle-completion-spec.md §4.2, build order §8 step 6).
--
-- Pilot executor is 'manual': digital orders land in an ops queue
-- (admin-dashboard) and an operator marks the job delivered/failed. Provider
-- adapters are a later executor-swap, same table, same states.
--
-- order_id is the idempotency key (UNIQUE) -- a double-enqueue for the same
-- order is a no-op, matching "double-topup is as bad as no topup".

CREATE TABLE IF NOT EXISTS fulfillment_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES merchant_transactions(id),
  executor      text NOT NULL DEFAULT 'manual',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts      integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  provider_ref  text,
  last_error    text,
  next_retry_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_status ON fulfillment_jobs (status, created_at);

ALTER TABLE fulfillment_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fulfillment_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON fulfillment_jobs TO service_role;

-- ── Enqueue: placed -> provider_pending + create the job ────────────────────
-- Idempotent: if a job already exists for this order, returns it unchanged
-- instead of erroring (a retried request must not double-enqueue).
CREATE OR REPLACE FUNCTION enqueue_digital_fulfillment(
  p_order_id uuid,
  p_payload  jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(ok boolean, error_code text, job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing_id uuid;
  v_advance     record;
  v_job_id      uuid;
BEGIN
  SELECT id INTO v_existing_id FROM fulfillment_jobs WHERE order_id = p_order_id;
  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT true, ''::text, v_existing_id; RETURN;
  END IF;

  SELECT * INTO v_advance FROM advance_order_status(
    p_order_id, 'provider_pending', 'system',
    jsonb_build_object('reason', 'digital_fulfillment_enqueued')
  );
  IF NOT v_advance.ok THEN
    RETURN QUERY SELECT false, v_advance.error_code, NULL::uuid; RETURN;
  END IF;

  INSERT INTO fulfillment_jobs (order_id, executor, payload, status)
  VALUES (p_order_id, 'manual', COALESCE(p_payload, '{}'::jsonb), 'pending')
  RETURNING id INTO v_job_id;

  RETURN QUERY SELECT true, ''::text, v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_digital_fulfillment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_digital_fulfillment(uuid, jsonb) TO service_role;

-- ── Ops action: mark delivered ───────────────────────────────────────────────
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

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION complete_fulfillment_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_fulfillment_job(uuid, text) TO service_role;

-- ── Ops action: mark failed ──────────────────────────────────────────────────
-- Per spec: failing a job should auto-cancel the order and create a refund
-- row. The refunds table doesn't exist yet (build order step 3, not shipped),
-- so this stops at fulfil_failed -- cancellation with a tracked refund is a
-- follow-up once that table lands. Until then this is a real gap: money is
-- not automatically returned when a digital fulfilment job fails.
CREATE OR REPLACE FUNCTION fail_fulfillment_job(
  p_job_id uuid,
  p_error  text
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

  SELECT * INTO v_advance FROM advance_order_status(
    v_job.order_id, 'fulfil_failed', 'system',
    jsonb_build_object('reason', 'digital_fulfillment_failed', 'error', p_error)
  );
  IF NOT v_advance.ok THEN
    RETURN QUERY SELECT false, v_advance.error_code; RETURN;
  END IF;

  UPDATE fulfillment_jobs
  SET status = 'failed', last_error = p_error, attempts = attempts + 1, updated_at = now()
  WHERE id = p_job_id;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION fail_fulfillment_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_fulfillment_job(uuid, text) TO service_role;

-- ── Ops action: retry a failed job ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION retry_fulfillment_job(
  p_job_id uuid
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job      record;
  v_advance1 record;
  v_advance2 record;
BEGIN
  SELECT * INTO v_job FROM fulfillment_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'JOB_NOT_FOUND'; RETURN;
  END IF;
  IF v_job.status <> 'failed' THEN
    RETURN QUERY SELECT false, 'JOB_NOT_FAILED'; RETURN;
  END IF;

  SELECT * INTO v_advance1 FROM advance_order_status(v_job.order_id, 'retrying', 'system', '{}'::jsonb);
  IF NOT v_advance1.ok THEN
    RETURN QUERY SELECT false, v_advance1.error_code; RETURN;
  END IF;

  SELECT * INTO v_advance2 FROM advance_order_status(v_job.order_id, 'provider_pending', 'system', '{}'::jsonb);
  IF NOT v_advance2.ok THEN
    RETURN QUERY SELECT false, v_advance2.error_code; RETURN;
  END IF;

  UPDATE fulfillment_jobs
  SET status = 'pending', last_error = NULL, updated_at = now()
  WHERE id = p_job_id;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION retry_fulfillment_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION retry_fulfillment_job(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
