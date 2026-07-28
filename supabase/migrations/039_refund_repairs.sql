-- Refund repairs (paid-order-recovery-spec.md Phase 2 "Repair refunds",
-- order-lifecycle-completion-spec.md §6 "void pending rewards on cancel").
--
-- 1. order_cancellation_compensations.order_id becomes nullable: an admin
--    can now track a refund for an orphaned payment that never got an order
--    at all (see the reconciliation-queue "Refund instead" action), not just
--    for a cancelled order.
-- 2. amount_kes: the rail-native M-Pesa amount. Crypto orders already have a
--    rail-native record (amount_cusd + payment_currency = token amount +
--    symbol, since payment_currency stores the token symbol and amount_cusd
--    is computed directly from the on-chain Transfer value) — M-Pesa orders
--    didn't carry their KES amount into the refund row even though
--    merchant_transactions.amount_kes already has it.
-- 3. Cancellation compensation (voucher reinstatement / settlement
--    adjustment) failures were only RAISE WARNING'd -- silently unrecorded.
--    Now they also write a reconciliation_incidents row so a failed
--    compensation is never lost, matching the refund-row invariant's own
--    "mandatory reconciliation record" bar.
-- 4. Cancelling an order voids its accrued-but-unreleased reward payload —
--    nothing to claw back, since release only ever happens at 'completed'.

ALTER TABLE order_cancellation_compensations
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS amount_kes numeric;

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

    -- Void the reward accrued at purchase — release only ever happens at
    -- 'completed', so a cancelled order has nothing to claw back; clearing
    -- the payload just stops a stray future release attempt.
    UPDATE merchant_transactions SET pending_reward_payload = NULL WHERE id = p_order_id;

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
        -- Best-effort compensation must not block the cancel itself, but a
        -- failure here can no longer disappear silently: it's now a
        -- mandatory reconciliation record, not just a log line.
        RAISE WARNING 'voucher/settlement compensation failed for order %: %', p_order_id, SQLERRM;
        INSERT INTO reconciliation_incidents (type, voucher_id, order_id, data)
        VALUES (
          'cancellation_compensation_failed', v_order.voucher_id, p_order_id,
          jsonb_build_object('error', SQLERRM, 'actor', p_actor)
        );
      END;
    END IF;

    -- Refund row: the invariant. A cancelled order that consumed a real
    -- payment MUST get one, in this same transaction. Not guarded -- if this
    -- fails, the cancel itself rolls back rather than silently losing the
    -- refund trail.
    IF COALESCE(v_order.amount_cusd, 0) > 0 AND v_order.payment_ref IS NOT NULL THEN
      v_rail := CASE
        WHEN v_order.payment_method::text LIKE 'crypto:%' OR v_order.payment_method::text = 'onchain_transfer' THEN 'crypto'
        ELSE 'mpesa'
      END;

      INSERT INTO order_cancellation_compensations (
        order_id, user_address, partner_id, amount_cusd, amount_kes, payment_ref, payment_currency,
        voucher_id, voucher_reinstated, refund_status, rail, reason
      ) VALUES (
        p_order_id, v_order.user_address, v_order.partner_id, v_order.amount_cusd,
        CASE WHEN v_rail = 'mpesa' THEN v_order.amount_kes ELSE NULL END,
        v_order.payment_ref, v_order.payment_currency,
        v_order.voucher_id, v_voucher_reinstated, 'pending_manual', v_rail,
        COALESCE(p_meta->>'reason', 'unspecified')
      )
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  -- ── Customer notifications (§5.2) ────────────────────────────────────────
  v_template := CASE p_to_status
    WHEN 'accepted'         THEN 'order_accepted'
    WHEN 'out_for_delivery' THEN 'order_dispatched'
    WHEN 'delivered'        THEN NULL
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

  IF p_to_status = 'cancelled' AND COALESCE(v_order.amount_cusd, 0) > 0 AND v_order.payment_ref IS NOT NULL THEN
    INSERT INTO notification_outbox (user_ref, order_id, template, dedupe_key, metadata)
    VALUES (v_order.user_address, p_order_id, 'refund_initiated', 'notif:' || p_order_id::text || ':refund_initiated', '{}'::jsonb)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

NOTIFY pgrst, 'reload schema';
