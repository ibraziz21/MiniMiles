-- Phase 6 — Reconciliation and launch qualification
-- (order-lifecycle-completion-spec.md §7: "every acceptance criterion in the
-- lifecycle spec passes with recorded evidence").
--
-- 1. v_stuck_orders only covered the four statuses that existed when it was
--    first written (035/036). Phases 4-5 added durable reward jobs and
--    digital-fulfilment hardening, which introduced four more statuses an
--    order can silently sit in if their own safety nets fail:
--      - packed:        merchant packed but never dispatched.
--      - received:      customer/system marked received but the 1h
--                        auto-complete sweep (auto_complete_stale_deliveries)
--                        didn't run -- the strongest signal something in the
--                        cron itself is broken, not just a slow order.
--      - fulfil_failed: ops has neither retried nor let the 3rd failure
--                        auto-cancel it (041) -- needs a human to act.
--      - retrying:      retry_fulfillment_job transitions this straight to
--                        provider_pending in the same call, so a row parked
--                        here means that RPC crashed mid-flight.
--    SLA windows below are judgment calls (no spec-mandated number for these
--    four), chosen to be looser than the automated-repair windows they sit
--    next to so the queue doesn't fire on ordinary timing jitter:
--      - packed: 24h (half of accepted's 48h -- packing is the shorter step).
--      - received: 2h (double the 1h auto-complete sweep interval).
--      - fulfil_failed: 6h (ops response window; longer than any automated step).
--      - retrying: 15m (matches provider_pending's existing window -- both
--        are meant to be near-instantaneous system-only transitions).
--
-- 2. received -> completed only allowed actor 'system' (the auto-complete
--    sweep). That left admin with no manual escape hatch for exactly the
--    case this queue exists to catch: the sweep isn't running. Adds 'admin'
--    to that transition's allowed actors so the stuck-orders queue's
--    operator action can force it through.
--
-- 3. reconciliation_digests: a persisted daily snapshot of the four queue
--    counts, written by a new cron-callable endpoint
--    (admin-dashboard: POST /api/admin/reconciliation/digest). Delivery
--    (email/Slack forward) is the same manual wiring step already flagged
--    for the other /api/internal/* cron endpoints -- this just gives that
--    external scheduler something durable to read and alert on, and keeps
--    a history so "queues went to zero" has recorded evidence, not just a
--    live dashboard number.

CREATE OR REPLACE VIEW v_stuck_orders AS
SELECT * FROM (
  SELECT
    id, partner_id, status, created_at,
    CASE status
      WHEN 'placed'           THEN created_at + interval '24 hours'
      WHEN 'accepted'         THEN accepted_at + interval '48 hours'
      WHEN 'packed'           THEN packed_at + interval '24 hours'
      WHEN 'out_for_delivery' THEN dispatched_at + interval '72 hours'
      WHEN 'provider_pending' THEN provider_pending_at + interval '15 minutes'
      WHEN 'received'         THEN received_at + interval '2 hours'
      WHEN 'fulfil_failed'    THEN fulfil_failed_at + interval '6 hours'
      WHEN 'retrying'         THEN retrying_at + interval '15 minutes'
      ELSE NULL
    END AS sla_deadline
  FROM merchant_transactions
  WHERE status IN (
    'placed', 'accepted', 'packed', 'out_for_delivery', 'provider_pending',
    'received', 'fulfil_failed', 'retrying'
  )
) s
WHERE sla_deadline IS NOT NULL AND now() > sla_deadline;

INSERT INTO order_status_transitions (from_status, to_status, allowed_actors) VALUES
  ('received', 'completed', ARRAY['system', 'admin'])
ON CONFLICT (from_status, to_status) DO UPDATE SET allowed_actors = EXCLUDED.allowed_actors;

CREATE TABLE IF NOT EXISTS reconciliation_digests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orphaned_count  integer NOT NULL,
  stuck_count     integer NOT NULL,
  refunds_count   integer NOT NULL,
  disputes_count  integer NOT NULL,
  total_count     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON reconciliation_digests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON reconciliation_digests TO service_role;

NOTIFY pgrst, 'reload schema';
