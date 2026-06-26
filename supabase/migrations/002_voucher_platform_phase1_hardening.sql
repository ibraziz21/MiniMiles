-- 002_voucher_platform_phase1_hardening.sql
-- Additive, idempotent hardening pass applied on top of 001.
-- 001 is already deployed to production; never modify 001.
--
-- Fixes:
--   A. Canonical recovery_state constraint (drops any auto-named variant first)
--   B. place_hub_order_and_redeem_voucher: validate against actual order fields,
--      fail closed for legacy wallet-address ownership, record actual fields in
--      voucher_redemptions instead of the client-duplicated params
--   C. Canonical voucher_events event_type constraint with recovery event support
--   D. New record_burn_outcome RPC: sets recovery_state + inserts audit event
--      in one atomic transaction so callers can reliably detect persistence failure

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Canonical recovery_state constraint
-- ══════════════════════════════════════════════════════════════════════════════
-- PostgreSQL names auto-generated CHECK constraints after the table and column,
-- e.g., 'issued_vouchers_recovery_state_check'.  Drop every constraint that
-- references recovery_state regardless of its current name, then recreate one
-- canonical, explicitly-named version.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'issued_vouchers'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%recovery_state%'
  LOOP
    EXECUTE format('ALTER TABLE issued_vouchers DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  ALTER TABLE issued_vouchers
    ADD CONSTRAINT chk_iv_recovery_state
      CHECK (
        recovery_state IS NULL OR
        recovery_state IN ('burn_ambiguous', 'burn_confirmed_promote_failed')
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Fixed place_hub_order_and_redeem_voucher
-- ══════════════════════════════════════════════════════════════════════════════
-- Fixes two security bugs present in 001:
--
-- Bug A — Duplicate-param tampering:
--   001 validated the voucher's merchant/product/category against
--   p_merchant_id, p_product_id_scope, and p_product_category — parameters
--   that the caller duplicated from the real order fields.  A tampered call
--   could set these to match the voucher while sending different actual order
--   fields, bypassing the scope check.  This version validates against the
--   ACTUAL order parameters: p_partner_id, p_product_id, p_item_category.
--   The three legacy params are retained in the signature for call-site
--   compatibility but are not used for security-critical validation.
--
-- Bug B — Legacy ownership fails OPEN:
--   When v_row.hub_user_id IS NULL (wallet-address voucher) AND the caller
--   passes p_user_addresses IS NULL, 001's ELSIF branch was never entered and
--   ownership was silently skipped.  This version uses ELSE (always entered)
--   and raises WRONG_OWNER immediately when p_user_addresses is NULL or empty.
--
-- Also: voucher_redemptions records p_partner_id / p_product_id (actual values)
-- instead of the client-supplied p_merchant_id / p_product_id_scope.

CREATE OR REPLACE FUNCTION place_hub_order_and_redeem_voucher(
  -- Order fields
  p_partner_id        uuid,
  p_user_address      text,
  p_item_name         text,
  p_item_category     text,
  p_product_id        text,
  p_payment_ref       text,
  p_payment_currency  text,
  p_payment_method    text,
  p_amount_cusd       double precision,
  p_amount_kes        integer,
  p_voucher_code      text,
  p_voucher_id        uuid,
  p_recipient_name    text,
  p_phone             text,
  p_city              text,
  p_location_details  text,
  -- Voucher redemption fields (all NULL when no voucher)
  p_hub_user_id       uuid,
  p_merchant_id       uuid,    -- deprecated: retained for compat, not used for validation
  p_product_id_scope  text,    -- deprecated: retained for compat, not used for validation
  p_product_category  text,    -- deprecated: retained for compat, not used for validation
  p_discount_applied  numeric,
  p_user_addresses    text[]
)
RETURNS TABLE (ok boolean, order_id uuid, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id        uuid;
  v_row             record;
  v_snap            jsonb;
  v_snap_merchant   text;
  v_snap_product    text;
  v_snap_category   text;
  v_max_discount    numeric;
BEGIN
  -- 1. If a voucher is being redeemed: lock row and fully revalidate
  IF p_voucher_id IS NOT NULL THEN
    -- FOR UPDATE OF iv: PostgreSQL forbids FOR UPDATE on the nullable side of a
    -- LEFT JOIN, so we lock only the issued_vouchers row.
    SELECT iv.*,
           sv.partner_id          AS tmpl_merchant_id,
           sv.linked_product_id   AS tmpl_linked_product_id,
           sv.applicable_category AS tmpl_applicable_category,
           sv.retail_value_cusd   AS tmpl_retail_value_cusd
      INTO v_row
      FROM issued_vouchers iv
      LEFT JOIN spend_voucher_templates sv ON sv.id = iv.voucher_template_id
     WHERE iv.id = p_voucher_id
       FOR UPDATE OF iv;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'VOUCHER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    -- 1a. Status check
    IF v_row.status <> 'claiming' THEN
      RAISE EXCEPTION 'WRONG_STATUS' USING ERRCODE = 'P0001';
    END IF;

    -- 1b. Expiry check
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
      UPDATE issued_vouchers SET status = 'expired' WHERE id = p_voucher_id;
      INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id)
      VALUES (p_voucher_id, 'expired', COALESCE(p_hub_user_id::text, p_user_address));
      RAISE EXCEPTION 'EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    -- 1c. Ownership re-check
    IF v_row.hub_user_id IS NOT NULL THEN
      -- Authenticated Hub user path
      IF p_hub_user_id IS NULL OR v_row.hub_user_id <> p_hub_user_id THEN
        RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- Legacy wallet-address voucher: fail CLOSED when caller omitted p_user_addresses.
      -- Bug B fix: ELSE (not ELSIF) so this branch is always taken for non-hub vouchers.
      IF p_user_addresses IS NULL OR array_length(p_user_addresses, 1) IS NULL THEN
        RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE = 'P0001';
      END IF;
      IF NOT (lower(v_row.user_address) = ANY(
        SELECT lower(a) FROM unnest(p_user_addresses) AS a
      )) THEN
        RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- 1d. Merchant / product / category validation under the row lock
    -- Bug A fix: validate against ACTUAL order fields (p_partner_id, p_product_id,
    -- p_item_category), not the client-duplicated p_merchant_id / p_product_id_scope /
    -- p_product_category which a tampered caller could set independently.
    v_snap := v_row.rules_snapshot;

    IF v_snap IS NOT NULL THEN
      v_snap_merchant := v_snap->>'merchant_id';
      v_snap_product  := v_snap->>'linked_product_id';
      v_snap_category := v_snap->>'applicable_category';
      v_max_discount  := (v_snap->>'retail_value_cusd')::numeric;
    ELSE
      -- Legacy rows: derive from template JOIN (never from issued_vouchers columns)
      v_snap_merchant := v_row.tmpl_merchant_id::text;
      v_snap_product  := v_row.tmpl_linked_product_id::text;
      v_snap_category := v_row.tmpl_applicable_category;
      v_max_discount  := v_row.tmpl_retail_value_cusd;
    END IF;

    IF v_snap_merchant IS NOT NULL AND v_snap_merchant <> p_partner_id::text THEN
      RAISE EXCEPTION 'WRONG_MERCHANT' USING ERRCODE = 'P0001';
    END IF;

    IF v_snap_product IS NOT NULL AND v_snap_product <> p_product_id THEN
      RAISE EXCEPTION 'WRONG_PRODUCT' USING ERRCODE = 'P0001';
    END IF;

    IF v_snap_category IS NOT NULL AND v_snap_product IS NULL
       AND v_snap_category <> p_item_category THEN
      RAISE EXCEPTION 'WRONG_CATEGORY' USING ERRCODE = 'P0001';
    END IF;

    -- 1e. Discount cap
    IF v_max_discount IS NOT NULL AND p_discount_applied > v_max_discount + 0.005 THEN
      RAISE EXCEPTION 'DISCOUNT_EXCEEDS_CAP' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2. Insert the order (atomic with voucher update below)
  INSERT INTO merchant_transactions (
    partner_id, user_address, status, item_name, item_category,
    product_id, payment_ref, payment_currency, payment_method,
    amount_cusd, amount_kes, voucher_code, voucher_id,
    recipient_name, phone, city, location_details
  ) VALUES (
    p_partner_id, p_user_address, 'placed', p_item_name, p_item_category,
    p_product_id, p_payment_ref, p_payment_currency, p_payment_method,
    p_amount_cusd, p_amount_kes, p_voucher_code, p_voucher_id,
    p_recipient_name, p_phone, p_city, p_location_details
  )
  RETURNING id INTO v_order_id;

  -- 3. Finalise voucher redemption in the same transaction
  IF p_voucher_id IS NOT NULL THEN
    UPDATE issued_vouchers
       SET status = 'redeemed', redeemed_at = now()
     WHERE id = p_voucher_id AND status = 'claiming';

    -- Record actual order fields (p_partner_id, p_product_id) not the deprecated
    -- client-supplied duplicates (p_merchant_id, p_product_id_scope).
    INSERT INTO voucher_redemptions (
      issued_voucher_id, order_id, hub_user_id, user_address,
      merchant_id, product_id, discount_applied, redeemed_at
    ) VALUES (
      p_voucher_id, v_order_id::text, p_hub_user_id, p_user_address,
      p_partner_id, p_product_id, p_discount_applied, now()
    );

    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
    VALUES (
      p_voucher_id, 'redeemed',
      COALESCE(p_hub_user_id::text, p_user_address),
      jsonb_build_object(
        'order_id',         v_order_id,
        'merchant_id',      p_partner_id,
        'discount_applied', p_discount_applied
      )
    );
  END IF;

  RETURN QUERY SELECT true, v_order_id, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(uuid,text,text,text,text,text,text,text,double precision,integer,text,uuid,text,text,text,text,uuid,uuid,text,text,numeric,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(uuid,text,text,text,text,text,text,text,double precision,integer,text,uuid,text,text,text,text,uuid,uuid,text,text,numeric,text[]) FROM anon;
REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(uuid,text,text,text,text,text,text,text,double precision,integer,text,uuid,text,text,text,text,uuid,uuid,text,text,numeric,text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION place_hub_order_and_redeem_voucher(uuid,text,text,text,text,text,text,text,double precision,integer,text,uuid,text,text,text,text,uuid,uuid,text,text,numeric,text[]) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Canonical voucher event-type constraint
-- ══════════════════════════════════════════════════════════════════════════════
-- 001 did not allow the burn_confirmed_promote_failed recovery event. Drop any
-- CHECK constraint that governs event_type, regardless of its generated name,
-- then recreate one canonical definition. This remains safe on repeated runs.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'voucher_events'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE voucher_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  ALTER TABLE voucher_events
    ADD CONSTRAINT chk_ve_event_type
      CHECK (event_type IN (
        'reserved','burn_confirmed','burn_confirmed_promote_failed','issued',
        'claimed','released','redeemed','voided','expired','reconciled',
        'burn_ambiguous'
      ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Atomic burn recovery RPC
-- ══════════════════════════════════════════════════════════════════════════════
-- Sets recovery_state AND inserts the audit event in a single transaction.
-- The caller MUST check the return error; if this RPC fails the caller MUST NOT
-- claim "the voucher is held for reconciliation" — persistence failed, so no
-- reconciliation evidence exists.

CREATE OR REPLACE FUNCTION record_burn_outcome(
  p_voucher_id     uuid,
  p_actor_id       text,
  p_recovery_state text,
  p_event_type     text,
  p_metadata       jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE issued_vouchers
     SET recovery_state = p_recovery_state
   WHERE id = p_voucher_id;

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (p_voucher_id, p_event_type, p_actor_id, p_metadata);
END;
$$;

REVOKE ALL ON FUNCTION record_burn_outcome(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_burn_outcome(uuid, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION record_burn_outcome(uuid, text, text, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_burn_outcome(uuid, text, text, text, jsonb) TO service_role;
