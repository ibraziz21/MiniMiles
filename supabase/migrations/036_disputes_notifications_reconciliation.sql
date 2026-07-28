-- Auto-complete, disputes, notifications outbox, admin reconciliation queues
-- (order-lifecycle-completion-spec.md §1 auto-complete rule, §4.4, §5.2, §7,
-- build order §8 steps 5 and 7).
--
-- delivered->disputed, disputed->received, disputed->cancelled were already
-- added to order_status_transitions in the phase-1 backbone migration
-- (032) -- no new transition rows needed here.

-- ── Notifications outbox (§5.2, in-app only for the pilot) ─────────────────
CREATE TABLE IF NOT EXISTS notification_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref   text NOT NULL,  -- merchant_transactions.user_address (wallet/email/id) -- always set, unlike hub_user_id
  order_id   uuid REFERENCES merchant_transactions(id),
  template   text NOT NULL,
  channel    text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'sms')),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  dedupe_key text,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_ref ON notification_outbox (user_ref, created_at DESC);

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON notification_outbox TO service_role;

-- ── advance_order_status: notify on customer-visible transitions ───────────
-- In-app only (status stays 'sent' immediately -- there's no real delivery
-- step yet; the channel column exists so SMS/email can be added later
-- without a schema change).
CREATE OR REPLACE FUNCTION advance_order_status(
  p_order_id  uuid,
  p_to_status text,
  p_actor     text,
  p_meta      jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order              merchant_transactions%ROWTYPE;
  v_allowed            text[];
  v_at_column          text;
  v_rail               text;
  v_voucher_reinstated boolean := false;
  v_redemption_id      uuid;
  v_settlement_entry   record;
  v_template           text;
  v_is_digital         boolean;
BEGIN
  SELECT * INTO v_order FROM merchant_transactions WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'; RETURN;
  END IF;

  SELECT allowed_actors INTO v_allowed
  FROM order_status_transitions
  WHERE from_status = v_order.status::text AND to_status = p_to_status;

  IF v_allowed IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_TRANSITION'; RETURN;
  END IF;
  IF NOT (p_actor = ANY(v_allowed)) THEN
    RETURN QUERY SELECT false, 'ACTOR_NOT_ALLOWED'; RETURN;
  END IF;

  v_at_column := CASE p_to_status
    WHEN 'accepted'         THEN 'accepted_at'
    WHEN 'packed'           THEN 'packed_at'
    WHEN 'out_for_delivery' THEN 'dispatched_at'
    WHEN 'delivered'        THEN 'delivered_at'
    WHEN 'received'         THEN 'received_at'
    WHEN 'completed'        THEN 'completed_at'
    WHEN 'cancelled'        THEN 'cancelled_at'
    WHEN 'provider_pending' THEN 'provider_pending_at'
    WHEN 'fulfil_failed'    THEN 'fulfil_failed_at'
    WHEN 'retrying'         THEN 'retrying_at'
    WHEN 'disputed'         THEN 'disputed_at'
    ELSE NULL
  END;

  PERFORM set_config('akiba.allow_status_change', 'true', true);

  IF v_at_column IS NOT NULL THEN
    EXECUTE format('UPDATE merchant_transactions SET status = $1::tx_status, %I = now() WHERE id = $2', v_at_column)
      USING p_to_status, p_order_id;
  ELSE
    UPDATE merchant_transactions SET status = p_to_status::tx_status WHERE id = p_order_id;
  END IF;

  INSERT INTO order_events (order_id, actor, from_status, to_status, meta)
  VALUES (p_order_id, p_actor, v_order.status::text, p_to_status, COALESCE(p_meta, '{}'::jsonb));

  -- ── Cancellation compensation, same transaction as the cancel ────────────
  IF p_to_status = 'cancelled' THEN
    IF v_order.voucher_id IS NOT NULL THEN
      BEGIN
        UPDATE issued_vouchers
        SET status = 'issued',
            expires_at = CASE
              WHEN expires_at IS NOT NULL AND expires_at < now() THEN now() + interval '7 days'
              ELSE expires_at
            END
        WHERE id = v_order.voucher_id AND status = 'redeemed';

        IF FOUND THEN
          v_voucher_reinstated := true;

          INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
          VALUES (v_order.voucher_id, 'reinstated', p_actor, jsonb_build_object('order_id', p_order_id));

          SELECT id INTO v_redemption_id FROM voucher_redemptions WHERE order_id = p_order_id::text LIMIT 1;

          IF v_redemption_id IS NOT NULL THEN
            SELECT merchant_id, program_id, payable_amount, currency INTO v_settlement_entry
            FROM voucher_settlement_entries
            WHERE voucher_redemption_id = v_redemption_id AND entry_type = 'payable_created'
            LIMIT 1;

            IF FOUND THEN
              PERFORM add_settlement_adjustment(
                v_settlement_entry.merchant_id, v_settlement_entry.program_id,
                -v_settlement_entry.payable_amount, v_settlement_entry.currency,
                'order_cancelled:' || p_order_id::text,
                'cancel-adjustment:' || p_order_id::text,
                p_actor
              );
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'voucher/settlement compensation failed for order %: %', p_order_id, SQLERRM;
      END;
    END IF;

    IF COALESCE(v_order.amount_cusd, 0) > 0 AND v_order.payment_ref IS NOT NULL THEN
      v_rail := CASE
        WHEN v_order.payment_method::text LIKE 'crypto:%' OR v_order.payment_method::text = 'onchain_transfer' THEN 'crypto'
        ELSE 'mpesa'
      END;

      INSERT INTO order_cancellation_compensations (
        order_id, user_address, partner_id, amount_cusd, payment_ref, payment_currency,
        voucher_id, voucher_reinstated, refund_status, rail, reason
      ) VALUES (
        p_order_id, v_order.user_address, v_order.partner_id, v_order.amount_cusd,
        v_order.payment_ref, v_order.payment_currency,
        v_order.voucher_id, v_voucher_reinstated, 'pending_manual', v_rail,
        COALESCE(p_meta->>'reason', 'unspecified')
      )
      ON CONFLICT (order_id) DO NOTHING;

      INSERT INTO notification_outbox (user_ref, order_id, template, dedupe_key, metadata)
      VALUES (v_order.user_address, p_order_id, 'refund_initiated', 'notif:' || p_order_id::text || ':refund_initiated', '{}'::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END IF;

  -- ── Customer notifications (§5.2) ────────────────────────────────────────
  v_template := CASE p_to_status
    WHEN 'accepted'         THEN 'order_accepted'
    WHEN 'out_for_delivery' THEN 'order_dispatched'
    WHEN 'delivered'        THEN NULL  -- resolved below (physical vs digital copy)
    WHEN 'cancelled'        THEN 'order_cancelled'
    ELSE NULL
  END;

  IF p_to_status = 'delivered' THEN
    SELECT EXISTS(SELECT 1 FROM fulfillment_jobs WHERE order_id = p_order_id) INTO v_is_digital;
    v_template := CASE WHEN v_is_digital THEN 'digital_delivered' ELSE 'order_delivered' END;
  END IF;

  IF v_template IS NOT NULL THEN
    INSERT INTO notification_outbox (user_ref, order_id, template, status, sent_at, dedupe_key, metadata)
    VALUES (
      v_order.user_address, p_order_id, v_template, 'sent', now(),
      'notif:' || p_order_id::text || ':' || v_template,
      jsonb_build_object('status', p_to_status)
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

-- ── Auto-complete: delivered + 7 days without customer action -> received ──
-- Disputing an order moves it out of 'delivered', so it's naturally excluded
-- here -- disputing freezes auto-complete by construction.
CREATE OR REPLACE FUNCTION auto_complete_stale_deliveries() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order  record;
  v_count  integer := 0;
  v_result record;
BEGIN
  FOR v_order IN
    SELECT id FROM merchant_transactions
    WHERE status = 'delivered' AND delivered_at IS NOT NULL AND delivered_at < now() - interval '7 days'
  LOOP
    SELECT * INTO v_result FROM advance_order_status(v_order.id, 'received', 'system', jsonb_build_object('reason', 'auto_complete_7d'));
    IF v_result.ok THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION auto_complete_stale_deliveries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_complete_stale_deliveries() TO service_role;

-- ── Admin reconciliation queues (§7) ────────────────────────────────────────
-- "Orphaned money" reuses the existing reconciliation_incidents mechanism
-- (order_rpc_failed_after_payment is already written whenever a verified
-- payment's order creation fails -- see api/shop/orders/route.ts).
CREATE OR REPLACE VIEW v_orphaned_payments AS
SELECT id, type, voucher_id, data, created_at
FROM reconciliation_incidents
WHERE type = 'order_rpc_failed_after_payment'
  AND resolved = false
  AND created_at < now() - interval '1 hour';

CREATE OR REPLACE VIEW v_stuck_orders AS
SELECT * FROM (
  SELECT
    id, partner_id, status, created_at,
    CASE status
      WHEN 'placed'           THEN created_at + interval '24 hours'
      WHEN 'accepted'         THEN accepted_at + interval '48 hours'
      WHEN 'out_for_delivery' THEN dispatched_at + interval '72 hours'
      WHEN 'provider_pending' THEN provider_pending_at + interval '15 minutes'
      ELSE NULL
    END AS sla_deadline
  FROM merchant_transactions
  WHERE status IN ('placed', 'accepted', 'out_for_delivery', 'provider_pending')
) s
WHERE sla_deadline IS NOT NULL AND now() > sla_deadline;

CREATE OR REPLACE VIEW v_stale_refunds AS
SELECT * FROM order_cancellation_compensations
WHERE refund_status = 'pending_manual' AND created_at < now() - interval '48 hours';

CREATE OR REPLACE VIEW v_open_disputes AS
SELECT id, partner_id, status, disputed_at
FROM merchant_transactions
WHERE status = 'disputed' AND disputed_at < now() - interval '72 hours';

GRANT SELECT ON v_orphaned_payments, v_stuck_orders, v_stale_refunds, v_open_disputes TO service_role;

NOTIFY pgrst, 'reload schema';
