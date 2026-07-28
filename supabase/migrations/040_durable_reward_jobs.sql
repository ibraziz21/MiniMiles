-- Durable reward release (order-lifecycle-completion-spec.md §6, build order
-- step 4). Replaces the best-effort pending_reward_payload column with a
-- proper job table: status, attempts, last_error, next_retry_at, released_at,
-- voided_at. A Platform outage now retries with backoff instead of the
-- reward silently never landing.
--
-- react-app already has its own durable, retriable reward queue
-- (lib/minipointQueue.ts — pending/processing/completed/failed + attempts,
-- used for order rewards and several other reward types). It doesn't need to
-- be migrated onto this table; the two apps' reward mechanisms are
-- legitimately different (react-app mints against an internal ledger,
-- hub-page calls Akiba-Platform's purchase-events API) and both already
-- trigger off the same advance_order_status transition. What both apps get
-- "for free" from this migration is the auto-complete safety net below,
-- since it operates on merchant_transactions/reward_jobs regardless of
-- which app created the order.

CREATE TABLE IF NOT EXISTS reward_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL UNIQUE REFERENCES merchant_transactions(id),
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'eligible', 'processing', 'released', 'voided')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  next_retry_at timestamptz,
  released_at   timestamptz,
  voided_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_jobs_eligible ON reward_jobs (next_retry_at) WHERE status = 'eligible';

ALTER TABLE reward_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reward_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON reward_jobs TO service_role;

-- ── Create the reward job atomically with the order ─────────────────────────
-- Postgres resolves CREATE OR REPLACE by exact parameter-type signature --
-- adding a new trailing parameter does NOT replace the existing function, it
-- creates a second overload (and calls with the old arg count become
-- ambiguous between the two). Same DROP-then-CREATE pattern 031 itself used
-- when it extended an even earlier version.
DROP FUNCTION IF EXISTS place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer
);

CREATE OR REPLACE FUNCTION place_hub_order_and_redeem_voucher(
  p_partner_id uuid,p_user_address text,p_item_name text,p_item_category text,
  p_product_id text,p_payment_ref text,p_payment_currency text,p_payment_method text,
  p_amount_cusd numeric,p_amount_kes integer,p_voucher_code text,p_voucher_id uuid,
  p_recipient_name text,p_phone text,p_city text,p_location_details text,
  p_hub_user_id uuid,p_merchant_id uuid,p_product_id_scope text,p_product_category text,
  p_discount_applied numeric,p_user_addresses text[],
  p_akiba_username text DEFAULT NULL,p_quote_kes integer DEFAULT NULL,
  p_delivery_kes integer DEFAULT NULL,p_discount_kes integer DEFAULT NULL,
  p_reward_payload jsonb DEFAULT NULL,
  -- Lets the caller pre-generate the order id so a reward payload built
  -- before this call (e.g. containing idempotencyKey = hub-purchase-<id>,
  -- which lib/akiba/purchase-events.ts's lookup path reconstructs the same
  -- way) matches the row actually created here.
  p_order_id uuid DEFAULT NULL
) RETURNS TABLE(ok boolean,order_id uuid,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE
  v_order_id uuid; v_iv record; v_discount numeric; v_gross numeric; v_redemption_id uuid;
  v_snap_product text; v_snap_category text; v_max_discount numeric;
BEGIN
  IF p_amount_cusd IS NULL OR p_amount_cusd < 0 OR p_amount_cusd > 1000000 THEN
    RAISE EXCEPTION 'INVALID_ORDER_AMOUNT' USING ERRCODE='P0001';
  END IF;
  IF p_voucher_id IS NOT NULL THEN
    SELECT * INTO v_iv FROM issued_vouchers WHERE id=p_voucher_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND' USING ERRCODE='P0001'; END IF;
    IF v_iv.status<>'claiming' THEN RAISE EXCEPTION 'WRONG_STATUS' USING ERRCODE='P0001'; END IF;
    IF v_iv.merchant_id IS DISTINCT FROM p_partner_id THEN RAISE EXCEPTION 'WRONG_MERCHANT' USING ERRCODE='P0001'; END IF;
    IF v_iv.hub_user_id IS NOT NULL THEN
      IF p_hub_user_id IS NULL OR v_iv.hub_user_id<>p_hub_user_id THEN RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE='P0001'; END IF;
    ELSIF p_user_addresses IS NULL OR NOT EXISTS(
      SELECT 1 FROM unnest(p_user_addresses) a WHERE lower(a)=lower(v_iv.user_address)
    ) THEN RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE='P0001';
    END IF;
    v_snap_product:=v_iv.rules_snapshot->>'linked_product_id';
    v_snap_category:=v_iv.rules_snapshot->>'applicable_category';
    IF v_snap_product IS NOT NULL AND v_snap_product<>p_product_id THEN RAISE EXCEPTION 'WRONG_PRODUCT' USING ERRCODE='P0001'; END IF;
    IF v_snap_product IS NULL AND v_snap_category IS NOT NULL AND v_snap_category<>p_item_category THEN RAISE EXCEPTION 'WRONG_CATEGORY' USING ERRCODE='P0001'; END IF;
    v_max_discount:=NULLIF(v_iv.rules_snapshot->>'retail_value_cusd','')::numeric;
    IF v_max_discount IS NOT NULL AND COALESCE(p_discount_applied,0)>v_max_discount+0.005 THEN
      RAISE EXCEPTION 'DISCOUNT_EXCEEDS_CAP' USING ERRCODE='P0001';
    END IF;
    v_gross:=round(p_amount_cusd::numeric+COALESCE(p_discount_applied,0),6);
    v_discount:=calculate_voucher_discount(v_iv.rules_snapshot,v_gross);
    IF abs(v_discount-COALESCE(p_discount_applied,0))>0.005 THEN RAISE EXCEPTION 'DISCOUNT_MISMATCH' USING ERRCODE='P0001'; END IF;
  END IF;

  INSERT INTO merchant_transactions(
    id,partner_id,akiba_username,user_address,category,action,quote_kes,
    labor_kes,discount_kes,paid_kes,status,item_name,item_category,product_id,payment_ref,
    payment_currency,payment_method,amount_cusd,amount_kes,voucher_code,voucher_id,
    recipient_name,phone,city,location_details
  ) VALUES(
    COALESCE(p_order_id, gen_random_uuid()),
    p_partner_id,
    COALESCE(NULLIF(trim(p_akiba_username),''),NULLIF(trim(p_user_address),''),'hub-user'),
    p_user_address,'general','redeem',COALESCE(p_quote_kes,p_amount_kes,0),
    COALESCE(p_delivery_kes,0),COALESCE(p_discount_kes,0),p_amount_kes,
    'placed',p_item_name,p_item_category,p_product_id,p_payment_ref,
    p_payment_currency,
    CASE
      WHEN p_payment_method IN ('minipay_send','cash','card','other','onchain_transfer')
        THEN p_payment_method::payment_method
      WHEN p_payment_method LIKE 'crypto:%'
        THEN 'onchain_transfer'::payment_method
      ELSE 'other'::payment_method
    END,
    p_amount_cusd,p_amount_kes,p_voucher_code,p_voucher_id,
    p_recipient_name,p_phone,p_city,p_location_details
  ) RETURNING id INTO v_order_id;

  IF p_reward_payload IS NOT NULL THEN
    INSERT INTO reward_jobs (order_id, payload, status)
    VALUES (v_order_id, p_reward_payload, 'pending')
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  IF p_voucher_id IS NOT NULL THEN
    UPDATE issued_vouchers SET status='redeemed',redeemed_at=now() WHERE id=p_voucher_id;
    INSERT INTO voucher_redemptions(
      issued_voucher_id,order_id,hub_user_id,user_address,merchant_id,product_id,
      discount_applied,redemption_channel,redeemed_at
    ) VALUES(
      p_voucher_id,v_order_id::text,p_hub_user_id,p_user_address,p_partner_id,p_product_id,
      v_discount,'online_order',now()
    ) RETURNING id INTO v_redemption_id;
    PERFORM create_voucher_payable(
      p_voucher_id,v_redemption_id,v_gross,v_discount,'redemption:'||v_redemption_id::text,
      jsonb_build_object('channel','online_order','order_id',v_order_id)
    );
    INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id,metadata)
    VALUES(p_voucher_id,'redeemed',COALESCE(p_hub_user_id::text,p_user_address),
      jsonb_build_object('order_id',v_order_id,'merchant_id',p_partner_id,'discount_applied',v_discount));
  END IF;
  RETURN QUERY SELECT true,v_order_id,''::text;
END;
$$;

REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer,jsonb,uuid
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer,jsonb,uuid
) TO service_role;

-- ── advance_order_status: mark reward eligible / void it ────────────────────
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

  -- Order completion makes an accrued reward eligible for release. The
  -- synchronous fast path (confirm route / digital completion) tries
  -- releasing it immediately after this call; the scheduled worker
  -- (process_reward_jobs) is what actually guarantees delivery.
  IF p_to_status = 'completed' THEN
    UPDATE reward_jobs SET status = 'eligible', updated_at = now()
    WHERE order_id = p_order_id AND status = 'pending';
  END IF;

  -- ── Cancellation compensation, same transaction as the cancel ────────────
  IF p_to_status = 'cancelled' THEN

    -- Void the reward accrued at purchase — nothing to claw back, since
    -- release only ever happens after 'completed'.
    UPDATE reward_jobs SET status = 'voided', voided_at = now(), updated_at = now()
    WHERE order_id = p_order_id AND status IN ('pending', 'eligible');

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
        INSERT INTO reconciliation_incidents (type, voucher_id, order_id, data)
        VALUES (
          'cancellation_compensation_failed', v_order.voucher_id, p_order_id,
          jsonb_build_object('error', SQLERRM, 'actor', p_actor)
        );
      END;
    END IF;

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

-- ── Reward job worker primitives ────────────────────────────────────────────

-- Claims a batch of eligible jobs (status -> 'processing') so the caller can
-- attempt Platform release outside this transaction. SKIP LOCKED means an
-- overlapping worker run can't double-claim the same job.
CREATE OR REPLACE FUNCTION claim_reward_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF reward_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE reward_jobs
  SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT id FROM reward_jobs
    WHERE status = 'eligible' AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_reward_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_reward_jobs(integer) TO service_role;

-- Records the outcome of a release attempt. Failure re-arms the job for
-- retry with linear backoff (5m, 10m, ... capped at 30m) rather than
-- terminally failing it -- a Platform outage must eventually resolve, not
-- strand the reward.
CREATE OR REPLACE FUNCTION complete_reward_job(
  p_job_id uuid,
  p_ok     boolean,
  p_error  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF p_ok THEN
    UPDATE reward_jobs
    SET status = 'released', released_at = now(), last_error = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    SELECT attempts + 1 INTO v_attempts FROM reward_jobs WHERE id = p_job_id;
    UPDATE reward_jobs
    SET status = 'eligible',
        attempts = v_attempts,
        last_error = p_error,
        next_retry_at = now() + (LEAST(v_attempts, 6) * interval '5 minutes'),
        updated_at = now()
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION complete_reward_job(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_reward_job(uuid, boolean, text) TO service_role;

-- ── Auto-complete: also advance received -> completed ───────────────────────
-- Physical orders normally go delivered -> received -> completed in one
-- customer request (confirm route). If the second hop fails transiently
-- (reward release hiccup, etc.) the order must not get stuck at 'received'
-- forever -- this sweep catches it and makes the reward eligible via the
-- same advance_order_status call.
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

  FOR v_order IN
    SELECT id FROM merchant_transactions
    WHERE status = 'received' AND received_at IS NOT NULL AND received_at < now() - interval '1 hour'
  LOOP
    SELECT * INTO v_result FROM advance_order_status(v_order.id, 'completed', 'system', jsonb_build_object('reason', 'auto_complete_received'));
    IF v_result.ok THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
