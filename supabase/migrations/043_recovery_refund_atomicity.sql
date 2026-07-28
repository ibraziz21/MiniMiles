-- Recovery/refund atomicity + reward-job lease fixes flagged in code review
-- of Phase 2/6 work.
--
-- 1. Customer recovery (POST /api/shop/orders/recover) and admin
--    "refund instead" (POST /api/admin/incidents/[id]/refund) both did a
--    check-then-act on reconciliation_incidents.resolved with no lock
--    between the check and the side effect (create order / insert refund).
--    Two concurrent requests could both pass the check and both perform
--    their side effect before either called resolve_reconciliation_incident
--    — producing both an order AND a refund for the same payment.
--    claim_reconciliation_incident() closes the window: it takes a row lock
--    (FOR UPDATE) and atomically marks the incident claimed, so only one
--    caller can proceed. A short lease (default 5m) means a crashed/never-
--    finished claim doesn't permanently block retries; the explicit release
--    function lets a *failed* side effect (e.g. recovery's order creation
--    itself fails) hand the incident back immediately instead of making the
--    customer wait out the lease.
--
-- 2. order_cancellation_compensations.partner_id was NOT NULL, but an
--    orphaned-payment incident's stored data snapshot doesn't always have
--    partner_id (older incidents, written before the order route started
--    recording it) -- "Refund instead" would 500 on exactly the incidents
--    Phase 0 exists to resolve. Made nullable, same reasoning migration 039
--    already applied to order_id for the same order-less-refund case.
--
-- 3. Order-less refunds (order_id IS NULL) had no idempotency guard at all
--    -- uq_occ_order_id only constrains rows that DO have an order_id.
--    Concurrent or repeated "refund instead" clicks for the same payment_ref
--    could insert duplicate order-less refund rows. Partial unique index
--    closes this without affecting the with-order case.
--
-- 4. claim_reward_jobs had no stale-processing recovery: if a worker crashed
--    between claiming a job (status='processing') and calling
--    complete_reward_job, that job could never be claimed again -- status
--    'processing' isn't in claim_reward_jobs' WHERE clause. Extends the
--    claim to also reclaim rows that have been 'processing' for >10 minutes
--    (comfortably longer than a single Platform HTTP call takes), using the
--    same updated_at column the claim itself already stamps -- no schema
--    change needed, same FOR UPDATE SKIP LOCKED concurrency-safety as the
--    original.

ALTER TABLE reconciliation_incidents
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE OR REPLACE FUNCTION claim_reconciliation_incident(
  p_incident_id uuid,
  p_actor       text,
  p_lease       interval DEFAULT '5 minutes'
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_incident record;
BEGIN
  SELECT * INTO v_incident FROM reconciliation_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'INCIDENT_NOT_FOUND'; RETURN;
  END IF;
  IF v_incident.resolved THEN
    RETURN QUERY SELECT false, 'ALREADY_RESOLVED'; RETURN;
  END IF;
  IF v_incident.claimed_at IS NOT NULL AND v_incident.claimed_at > now() - p_lease THEN
    RETURN QUERY SELECT false, 'ALREADY_CLAIMED'; RETURN;
  END IF;

  UPDATE reconciliation_incidents SET claimed_by = p_actor, claimed_at = now() WHERE id = p_incident_id;
  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION claim_reconciliation_incident(uuid, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_reconciliation_incident(uuid, text, interval) TO service_role;

CREATE OR REPLACE FUNCTION release_reconciliation_incident_claim(p_incident_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE reconciliation_incidents
  SET claimed_by = NULL, claimed_at = NULL
  WHERE id = p_incident_id AND resolved = false;
END;
$$;

REVOKE ALL ON FUNCTION release_reconciliation_incident_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_reconciliation_incident_claim(uuid) TO service_role;

ALTER TABLE order_cancellation_compensations
  ALTER COLUMN partner_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_occ_orderless_payment_ref
  ON order_cancellation_compensations (payment_ref)
  WHERE order_id IS NULL AND payment_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_reward_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF reward_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE reward_jobs
  SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT id FROM reward_jobs
    WHERE (status = 'eligible' AND (next_retry_at IS NULL OR next_retry_at <= now()))
       OR (status = 'processing' AND updated_at < now() - interval '10 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

NOTIFY pgrst, 'reload schema';
