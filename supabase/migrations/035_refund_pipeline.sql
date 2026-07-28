-- Refund pipeline + voucher/settlement compensation on cancel
-- (order-lifecycle-completion-spec.md §4.1 / §4.3, build order §8 step 3).
--
-- order_cancellation_compensations (packages/react-app/sql/order_cancellation_compensations.sql)
-- already exists and already functions as the pilot's refunds table: it has
-- amount/payment_ref/payment_currency, a UNIQUE(order_id) constraint, and a
-- refund_status workflow. Rather than build a second, parallel `refunds`
-- table, this migration extends it with the two columns the spec asks for
-- that it doesn't have yet (rail, reason), and moves compensation INTO
-- advance_order_status so it happens in the same transaction as the cancel
-- -- the previous path (dashboard-merchant -> HTTP webhook -> react-app ->
-- separate UPDATE) was not atomic with the cancel and could silently drop
-- compensation if the webhook failed.
--
-- Voucher reinstatement + settlement adjustment reuse the existing
-- voucher_events / voucher_settlement_entries ledger machinery
-- (add_settlement_adjustment already exists and already supports negative
-- amounts via entry_type='adjustment').

-- voucher_events.chk_ve_event_type (most recently redefined in 004) doesn't
-- allow 'reinstated' yet. Same drop-any-event_type-check-then-readd pattern
-- 002/004 already use, so this stays correct regardless of the constraint's
-- generated name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'voucher_events'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE voucher_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  ALTER TABLE voucher_events ADD CONSTRAINT chk_ve_event_type
    CHECK (event_type IN (
      'reserved','burn_confirmed','burn_confirmed_promote_failed','issued',
      'claimed','released','redeemed','voided','expired','reconciled',
      'burn_ambiguous','presented','presentation_revoked','reinstated'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ensure the table exists even if the standalone react-app script was never
-- run in this environment, then add the new columns either way.
CREATE TABLE IF NOT EXISTS order_cancellation_compensations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid        NOT NULL REFERENCES merchant_transactions(id) ON DELETE CASCADE,
  user_address        text        NOT NULL,
  partner_id          uuid        NOT NULL,
  amount_cusd         numeric,
  payment_ref         text,
  payment_currency    text,
  voucher_id          uuid,
  voucher_reinstated  boolean     NOT NULL DEFAULT false,
  refund_status       text        NOT NULL DEFAULT 'pending_manual'
                        CHECK (refund_status IN ('pending_manual', 'refunded', 'not_applicable')),
  refund_tx_hash      text,
  resolved_at         timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_occ_order_id ON order_cancellation_compensations (order_id);
CREATE INDEX IF NOT EXISTS idx_occ_refund_status ON order_cancellation_compensations (refund_status)
  WHERE refund_status = 'pending_manual';

ALTER TABLE order_cancellation_compensations
  ADD COLUMN IF NOT EXISTS rail   text CHECK (rail IN ('mpesa', 'crypto', 'miles')),
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE order_cancellation_compensations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_cancellation_compensations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON order_cancellation_compensations TO service_role;

-- ── Extend advance_order_status: compensation on cancel ─────────────────────
CREATE OR REPLACE FUNCTION advance_order_status(
  p_order_id  uuid,
  p_to_status text,
  p_actor     text,
  p_meta      jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order            merchant_transactions%ROWTYPE;
  v_allowed          text[];
  v_at_column        text;
  v_rail             text;
  v_voucher_reinstated boolean := false;
  v_redemption_id    uuid;
  v_settlement_entry record;
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

    -- Voucher reinstatement + settlement adjustment: best-effort. A missing
    -- settlement program (add_settlement_adjustment raises SETTLEMENT_TERMS_
    -- REQUIRED) must not block the cancel itself, so this whole block is
    -- guarded -- the refund-row invariant below is NOT guarded.
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
        order_id, user_address, partner_id, amount_cusd, payment_ref, payment_currency,
        voucher_id, voucher_reinstated, refund_status, rail, reason
      ) VALUES (
        p_order_id, v_order.user_address, v_order.partner_id, v_order.amount_cusd,
        v_order.payment_ref, v_order.payment_currency,
        v_order.voucher_id, v_voucher_reinstated, 'pending_manual', v_rail,
        COALESCE(p_meta->>'reason', 'unspecified')
      )
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

NOTIFY pgrst, 'reload schema';
