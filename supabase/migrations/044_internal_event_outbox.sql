-- Discovery quests, Stage 2 — internal-event outbox (discovery-quests-spec.md
-- §3.1/3.2/3.3, Akiba-Platform migration 061's `POST /api/v1/events/track`
-- contract).
--
-- pass_activated / voucher_redeemed / purchase_reversed gate real quest
-- completions, so they need the same accrue-then-release durability
-- reward_jobs already has (040_durable_reward_jobs.sql) rather than
-- quest-events.ts's fire-and-forget model (which its own comments call
-- "incentives, not critical path" — fine for that system, not for this one).
--
-- One outbox table shared by every app that already writes to this database
-- (hub-page, merchant-dashboard — confirmed same Supabase project). A single
-- hub-page-owned worker (process-internal-event-jobs) drains it regardless of
-- which app's RPC enqueued the row, so merchant-dashboard's voucher-redeem
-- path never needs its own Akiba HTTP client or API key.

CREATE TABLE IF NOT EXISTS internal_event_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  identities      jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'released', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_retry_at   timestamptz,
  released_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_event_jobs_pending
  ON internal_event_jobs (next_retry_at) WHERE status = 'pending';

ALTER TABLE internal_event_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal_event_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON internal_event_jobs TO service_role;

-- ── Worker primitives — copy reward_jobs' claim/complete shape exactly ──────

CREATE OR REPLACE FUNCTION claim_internal_event_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF internal_event_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE internal_event_jobs
  SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT id FROM internal_event_jobs
    WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_internal_event_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_internal_event_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION complete_internal_event_job(
  p_job_id uuid,
  p_ok     boolean,
  p_error  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF p_ok THEN
    UPDATE internal_event_jobs
    SET status = 'released', released_at = now(), last_error = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    SELECT attempts + 1 INTO v_attempts FROM internal_event_jobs WHERE id = p_job_id;
    UPDATE internal_event_jobs
    SET status = 'pending',
        attempts = v_attempts,
        last_error = p_error,
        next_retry_at = now() + (LEAST(v_attempts, 6) * interval '5 minutes'),
        updated_at = now()
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION complete_internal_event_job(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_internal_event_job(uuid, boolean, text) TO service_role;

-- ── pass_activated: atomic pass-row insert + outbox enqueue ─────────────────
-- Replaces the plain insert previously done in lib/akiba/pass.ts. `p_src`
-- lets join-complete/route.ts pass its captured join_qr/minipay_funnel value
-- straight through instead of a separate post-hoc `signup_src` UPDATE; every
-- other caller omits it and gets 'organic'.

CREATE OR REPLACE FUNCTION create_or_get_hub_pass(
  p_user_id uuid,
  p_email   text,
  p_src     text DEFAULT 'organic'
) RETURNS TABLE(public_pass_id uuid, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing uuid;
  v_inserted uuid;
BEGIN
  SELECT hup.public_pass_id INTO v_existing FROM hub_user_passes hup WHERE hup.user_id = p_user_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, false;
    RETURN;
  END IF;

  INSERT INTO hub_user_passes (user_id, email, signup_src)
  VALUES (p_user_id, p_email, p_src)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING hub_user_passes.public_pass_id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- Lost a race to a concurrent caller; fetch what it created.
    SELECT hup.public_pass_id INTO v_existing FROM hub_user_passes hup WHERE hup.user_id = p_user_id;
    RETURN QUERY SELECT v_existing, false;
    RETURN;
  END IF;

  INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
  VALUES (
    'pass_activated',
    'pass:' || p_user_id::text,
    jsonb_build_array(jsonb_build_object('type', 'email', 'value', p_email)),
    jsonb_build_object('src', p_src, 'userId', p_user_id)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY SELECT v_inserted, true;
END;
$$;

REVOKE ALL ON FUNCTION create_or_get_hub_pass(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_or_get_hub_pass(uuid, text, text) TO service_role;

-- ── voucher_redeemed (merchant-scan path): outbox row built from v_iv ──────
-- Signature is unchanged from 005_voucher_settlement_phase4.sql — this is a
-- CREATE OR REPLACE of the existing function body only, adding the
-- internal_event_jobs insert below using data already in scope (v_iv).

CREATE OR REPLACE FUNCTION redeem_voucher_in_store_atomic(
  p_token_hash text,
  p_partner_id uuid,
  p_merchant_user_id uuid,
  p_gross_amount_cusd numeric,
  p_external_reference text DEFAULT NULL
) RETURNS TABLE(ok boolean,voucher_id uuid,offer_title text,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_iv record; v_discount numeric; v_redemption_id uuid; v_title text; v_identities jsonb;
BEGIN
  SELECT * INTO v_iv FROM issued_vouchers
   WHERE redemption_token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_iv.status<>'issued'
     OR v_iv.redemption_token_expires_at IS NULL
     OR v_iv.redemption_token_expires_at<now()
     OR v_iv.merchant_id IS DISTINCT FROM p_partner_id THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,'INVALID'::text; RETURN;
  END IF;
  IF v_iv.expires_at IS NOT NULL AND v_iv.expires_at<now() THEN
    UPDATE issued_vouchers SET status='expired' WHERE id=v_iv.id;
    INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id)
    VALUES(v_iv.id,'expired',p_merchant_user_id::text);
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,'INVALID'::text; RETURN;
  END IF;

  v_discount := calculate_voucher_discount(v_iv.rules_snapshot,p_gross_amount_cusd);
  v_title := v_iv.rules_snapshot->>'title';

  UPDATE issued_vouchers SET status='redeemed',redeemed_at=now() WHERE id=v_iv.id;
  INSERT INTO voucher_redemptions(
    issued_voucher_id,hub_user_id,user_address,merchant_id,discount_applied,
    redemption_channel,merchant_user_id,external_reference,redeemed_at
  ) VALUES(
    v_iv.id,v_iv.hub_user_id,v_iv.user_address,p_partner_id,v_discount,
    'merchant_scan',p_merchant_user_id,p_external_reference,now()
  ) RETURNING id INTO v_redemption_id;

  PERFORM create_voucher_payable(
    v_iv.id,v_redemption_id,p_gross_amount_cusd,v_discount,
    'redemption:'||v_redemption_id::text,
    jsonb_build_object('channel','merchant_scan','external_reference',p_external_reference)
  );

  INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id,metadata)
  VALUES(v_iv.id,'redeemed',p_merchant_user_id::text,
    jsonb_build_object('merchant_id',p_partner_id,'channel','merchant_scan',
                       'gross_amount_cusd',p_gross_amount_cusd,'discount_applied',v_discount));
  INSERT INTO merchant_audit_log(merchant_user_id,partner_id,action,metadata)
  VALUES(p_merchant_user_id,p_partner_id,'voucher.redeemed',
    jsonb_build_object('voucher_id',v_iv.id,'channel','merchant_scan','discount_applied',v_discount));

  -- discovery-quests-spec.md §3.2. No email is available at this redemption
  -- point (issued_vouchers/voucher_redemptions carry no email column) — a
  -- wallet-only identity is a valid identity per Platform's contract, and
  -- building it here (rather than requiring merchant-dashboard's TS route to
  -- supply it) means that app needs no Akiba client, no API key, and no
  -- cross-package lookup back into hub_user_passes: it already has DB access
  -- to this same table via the RPC call it was making anyway.
  IF v_iv.user_address IS NOT NULL THEN
    v_identities := jsonb_build_array(jsonb_build_object('type','wallet','value',lower(v_iv.user_address)));

    INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
    VALUES (
      'voucher_redeemed',
      'vredeem:' || v_iv.id::text,
      v_identities,
      jsonb_build_object(
        'voucher_id', v_iv.id,
        'merchant_id', p_partner_id,
        'acquisition_source', v_iv.acquisition_source
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true,v_iv.id,v_title,''::text;
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text) TO service_role;

-- place_hub_order_and_redeem_voucher: same p_internal_event_payload addition,
-- same DROP-then-CREATE reasoning 040 itself documents (trailing-param
-- overload ambiguity).

DROP FUNCTION IF EXISTS place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer,jsonb,uuid
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
  p_order_id uuid DEFAULT NULL,
  p_internal_event_payload jsonb DEFAULT NULL
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

    IF p_internal_event_payload IS NOT NULL THEN
      INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
      VALUES (
        COALESCE(p_internal_event_payload->>'event_type', 'voucher_redeemed'),
        p_internal_event_payload->>'idempotency_key',
        COALESCE(p_internal_event_payload->'identities', '[]'::jsonb),
        COALESCE(p_internal_event_payload->'metadata', '{}'::jsonb)
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN QUERY SELECT true,v_order_id,''::text;
END;
$$;

REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer,jsonb,uuid,jsonb
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer,jsonb,uuid,jsonb
) TO service_role;

-- ── purchase_reversed: emitted from advance_order_status on cancellation ───
-- Only when a reward_jobs row existed to void (i.e. there was a genuine
-- purchase event on Platform this can correlate against and mark voided).
-- Full advance_order_status body copied from 040_durable_reward_jobs.sql
-- with the one addition inside the existing `p_to_status = 'cancelled'`
-- block — everything else is unchanged.

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
  v_reward_job         reward_jobs%ROWTYPE;
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
    -- release only ever happens after 'completed'. Capture the row first so
    -- a purchase_reversed event can be built from its stored payload (the
    -- same identity/metadata the original purchase event carried).
    SELECT * INTO v_reward_job FROM reward_jobs
    WHERE order_id = p_order_id AND status IN ('pending', 'eligible')
    FOR UPDATE;

    IF FOUND THEN
      UPDATE reward_jobs SET status = 'voided', voided_at = now(), updated_at = now()
      WHERE id = v_reward_job.id;

      INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
      VALUES (
        'purchase_reversed',
        'purchase_reversed:' || p_order_id::text,
        CASE
          WHEN v_reward_job.payload ? 'recipient'
            THEN jsonb_build_array(v_reward_job.payload->'recipient')
          ELSE '[]'::jsonb
        END,
        jsonb_build_object(
          'orderId', p_order_id,
          'reason', COALESCE(p_meta->>'reason', 'unspecified'),
          'originalIdempotencyKey', v_reward_job.payload->>'idempotencyKey'
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

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

NOTIFY pgrst, 'reload schema';
