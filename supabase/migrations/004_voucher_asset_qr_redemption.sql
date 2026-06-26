-- 004_voucher_asset_qr_redemption.sql
-- Phase 3: Voucher-as-asset + QR presentation / in-store redemption.
-- 001, 002 and 003 are deployed and immutable. Never modify them.
--
-- Compatibility guarantee:
--   • All ADD COLUMN / CREATE INDEX statements are idempotent (IF NOT EXISTS).
--   • All RPCs are SECURITY DEFINER, SET search_path = public,
--     REVOKE'd from PUBLIC/anon/authenticated, GRANT'd to service_role.
--   • Presentation tokens are stored ONLY as SHA-256 hex. Raw tokens never
--     touch the database. Token hashes never appear in error messages,
--     audit metadata, or any returned column.
--   • inspect_voucher_presentation returns a uniform generic shape for all
--     invalid cases to prevent token / voucher enumeration.
-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — issued_vouchers token columns
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE issued_vouchers ADD COLUMN IF NOT EXISTS redemption_token_expires_at timestamptz;
ALTER TABLE issued_vouchers ADD COLUMN IF NOT EXISTS redemption_token_issued_at  timestamptz;
ALTER TABLE issued_vouchers ADD COLUMN IF NOT EXISTS redemption_token_version    integer NOT NULL DEFAULT 0;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Unique partial index on redemption_token_hash
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_token_hash
  ON issued_vouchers (redemption_token_hash)
  WHERE redemption_token_hash IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — voucher_redemptions extensions
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS redemption_channel text;
ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS merchant_user_id   uuid;
ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS external_reference text;

DO $$ BEGIN
  ALTER TABLE voucher_redemptions DROP CONSTRAINT IF EXISTS chk_vr_redemption_channel;
  ALTER TABLE voucher_redemptions ADD CONSTRAINT chk_vr_redemption_channel
    CHECK (redemption_channel IS NULL OR redemption_channel IN ('online_order','merchant_scan'));
END $$;

ALTER TABLE voucher_redemptions ALTER COLUMN redemption_channel SET DEFAULT 'online_order';
UPDATE voucher_redemptions SET redemption_channel = 'online_order' WHERE redemption_channel IS NULL;
ALTER TABLE voucher_redemptions ALTER COLUMN redemption_channel SET NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Extend voucher_events CHECK constraint
-- ══════════════════════════════════════════════════════════════════════════════
-- 002 renamed the constraint to chk_ve_event_type. Drop ANY event_type check
-- constraint (regardless of its name), then re-add the canonical set — which
-- must include every value 002 allowed PLUS the new presentation events.

DO $$
DECLARE r record;
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
  ALTER TABLE voucher_events ADD CONSTRAINT chk_ve_event_type
    CHECK (event_type IN (
      'reserved','burn_confirmed','burn_confirmed_promote_failed','issued',
      'claimed','released','redeemed','voided','expired','reconciled',
      'burn_ambiguous','presented','presentation_revoked'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4b — Presentation-token lifecycle invariant
-- ══════════════════════════════════════════════════════════════════════════════
-- A presentation token is valid only while the voucher remains in the exact
-- status in which it was minted. Any status transition clears it. This covers
-- online checkout's issued→claiming transition, redemption, expiry and voiding.
-- A later claiming→issued release therefore cannot resurrect an old screenshot.

CREATE OR REPLACE FUNCTION fn_iv_clear_presentation_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.redemption_token_hash       := NULL;
    NEW.redemption_token_expires_at := NULL;
    NEW.redemption_token_issued_at  := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iv_clear_presentation_on_status_change ON issued_vouchers;
CREATE TRIGGER trg_iv_clear_presentation_on_status_change
  BEFORE UPDATE OF status ON issued_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_iv_clear_presentation_on_status_change();

-- Clean up tokens created by an earlier 004 draft before this invariant existed.
UPDATE issued_vouchers
   SET redemption_token_hash       = NULL,
       redemption_token_expires_at = NULL,
       redemption_token_issued_at  = NULL
 WHERE redemption_token_hash IS NOT NULL
   AND (
     status <> 'issued'
     OR redemption_token_expires_at IS NULL
     OR redemption_token_expires_at <= now()
     OR (expires_at IS NOT NULL AND expires_at <= now())
   );

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — issue_voucher_presentation_atomic
-- ══════════════════════════════════════════════════════════════════════════════
-- Mints (or rotates) a short-lived presentation token for a voucher the caller
-- owns. The raw token is generated by the API layer; only its SHA-256 hex is
-- supplied here. Max lifetime is 120s, enforced server-side.

CREATE OR REPLACE FUNCTION issue_voucher_presentation_atomic(
  p_voucher_id       uuid,
  p_hub_user_id      uuid,
  p_wallet_addresses text[],
  p_token_hash       text,
  p_token_expires_at timestamptz
)
RETURNS TABLE (
  ok                  boolean,
  token_version       integer,
  expires_at          timestamptz,
  offer_title         text,
  voucher_type        text,
  merchant_name       text,
  discount_percent    numeric,
  discount_cusd       numeric,
  applicable_category text,
  merchant_id         uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iv          record;
  v_new_version integer;
  v_owned       boolean;
  v_title       text;
  v_type        text;
  v_percent     numeric;
  v_fixed       numeric;
  v_category    text;
  v_partner_id  uuid;
BEGIN
  SELECT iv.id, iv.hub_user_id, iv.user_address, iv.status, iv.merchant_id,
         iv.expires_at, iv.redemption_token_version, iv.voucher_template_id,
         iv.rules_snapshot
    INTO v_iv
    FROM issued_vouchers iv
   WHERE iv.id = p_voucher_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;

  v_owned := (v_iv.hub_user_id = p_hub_user_id)
          OR (
            v_iv.user_address IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM unnest(COALESCE(p_wallet_addresses, ARRAY[]::text[])) AS wallet(address)
              WHERE lower(wallet.address) = lower(v_iv.user_address)
            )
          );
  IF NOT COALESCE(v_owned, false) THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_iv.status = 'redeemed' THEN
    RAISE EXCEPTION 'ALREADY_REDEEMED' USING ERRCODE = 'P0001';
  END IF;
  IF v_iv.status = 'void' THEN
    RAISE EXCEPTION 'VOUCHER_VOID' USING ERRCODE = 'P0001';
  END IF;

  -- Auto-expire a stale voucher before the presentability check.
  IF v_iv.expires_at IS NOT NULL AND v_iv.expires_at < now() THEN
    UPDATE issued_vouchers
       SET status = 'expired'
     WHERE id = p_voucher_id;
    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
    VALUES (p_voucher_id, 'expired', p_hub_user_id::text,
            jsonb_build_object('reason', 'expired_at_presentation'));
    RETURN QUERY
      SELECT false, v_iv.redemption_token_version, NULL::timestamptz,
             NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
             NULL::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_iv.status <> 'issued' THEN
    RAISE EXCEPTION 'VOUCHER_NOT_PRESENTABLE: status=%', v_iv.status USING ERRCODE = 'P0001';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_TOKEN_HASH' USING ERRCODE = 'P0001';
  END IF;

  IF p_token_expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRY_NOT_FUTURE' USING ERRCODE = 'P0001';
  END IF;

  IF p_token_expires_at > now() + interval '120 seconds' THEN
    RAISE EXCEPTION 'TOKEN_EXPIRY_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  v_new_version := COALESCE(v_iv.redemption_token_version, 0) + 1;

  UPDATE issued_vouchers
     SET redemption_token_hash       = p_token_hash,
         redemption_token_expires_at = p_token_expires_at,
         redemption_token_issued_at  = now(),
         redemption_token_version    = v_new_version
   WHERE id = p_voucher_id;

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (
    p_voucher_id, 'presented', p_hub_user_id::text,
    jsonb_build_object('token_version', v_new_version, 'channel', 'qr')
  );

  SELECT
    CASE WHEN v_iv.rules_snapshot ? 'title'
         THEN v_iv.rules_snapshot->>'title' ELSE svt.title END,
    CASE WHEN v_iv.rules_snapshot ? 'voucher_type'
         THEN v_iv.rules_snapshot->>'voucher_type' ELSE svt.voucher_type END,
    CASE WHEN v_iv.rules_snapshot ? 'discount_percent'
         THEN NULLIF(v_iv.rules_snapshot->>'discount_percent', '')::numeric
         ELSE svt.discount_percent END,
    CASE WHEN v_iv.rules_snapshot ? 'discount_cusd'
         THEN NULLIF(v_iv.rules_snapshot->>'discount_cusd', '')::numeric
         ELSE svt.discount_cusd END,
    CASE WHEN v_iv.rules_snapshot ? 'applicable_category'
         THEN v_iv.rules_snapshot->>'applicable_category'
         ELSE svt.applicable_category END,
    COALESCE(v_iv.merchant_id, svt.partner_id)
  INTO v_title, v_type, v_percent, v_fixed, v_category, v_partner_id
  FROM spend_voucher_templates svt
  WHERE svt.id = v_iv.voucher_template_id;

  RETURN QUERY
  SELECT true,
         v_new_version,
         p_token_expires_at,
         v_title,
         v_type,
         (SELECT p.name FROM partners p WHERE p.id = v_partner_id),
         v_percent,
         v_fixed,
         v_category,
         v_partner_id;
END;
$$;

REVOKE ALL ON FUNCTION issue_voucher_presentation_atomic(uuid,uuid,text[],text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_voucher_presentation_atomic(uuid,uuid,text[],text,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION issue_voucher_presentation_atomic(uuid,uuid,text[],text,timestamptz) FROM authenticated;
GRANT  EXECUTE ON FUNCTION issue_voucher_presentation_atomic(uuid,uuid,text[],text,timestamptz) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — revoke_voucher_presentation_atomic
-- ══════════════════════════════════════════════════════════════════════════════
-- Clears any live presentation token for a voucher the caller owns. Idempotent.

CREATE OR REPLACE FUNCTION revoke_voucher_presentation_atomic(
  p_voucher_id       uuid,
  p_hub_user_id      uuid,
  p_wallet_addresses text[]
)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iv    record;
  v_owned boolean;
BEGIN
  SELECT iv.id, iv.hub_user_id, iv.user_address, iv.redemption_token_hash
    INTO v_iv
    FROM issued_vouchers iv
   WHERE iv.id = p_voucher_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;

  v_owned := (v_iv.hub_user_id = p_hub_user_id)
          OR (
            v_iv.user_address IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM unnest(COALESCE(p_wallet_addresses, ARRAY[]::text[])) AS wallet(address)
              WHERE lower(wallet.address) = lower(v_iv.user_address)
            )
          );
  IF NOT COALESCE(v_owned, false) THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- No live token → idempotent no-op.
  IF v_iv.redemption_token_hash IS NULL THEN
    RETURN QUERY SELECT true;
    RETURN;
  END IF;

  UPDATE issued_vouchers
     SET redemption_token_hash       = NULL,
         redemption_token_expires_at = NULL,
         redemption_token_issued_at  = NULL
   WHERE id = p_voucher_id;

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (p_voucher_id, 'presentation_revoked', p_hub_user_id::text,
          jsonb_build_object('channel', 'qr'));

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION revoke_voucher_presentation_atomic(uuid,uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_voucher_presentation_atomic(uuid,uuid,text[]) FROM anon;
REVOKE ALL ON FUNCTION revoke_voucher_presentation_atomic(uuid,uuid,text[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION revoke_voucher_presentation_atomic(uuid,uuid,text[]) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — inspect_voucher_presentation
-- ══════════════════════════════════════════════════════════════════════════════
-- Read-only safe preview for a merchant scanner. Returns a UNIFORM generic
-- invalid shape for every failure case (no enumeration). Never leaks PII:
-- no user email, wallet address, raw rules JSON, token hash or internal fields.

CREATE OR REPLACE FUNCTION inspect_voucher_presentation(
  p_token_hash text,
  p_partner_id uuid
)
RETURNS TABLE (
  valid               boolean,
  invalid_reason      text,
  voucher_id          uuid,
  offer_title         text,
  voucher_type        text,
  discount_percent    numeric,
  discount_cusd       numeric,
  merchant_name       text,
  applicable_category text,
  token_expires_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iv              record;
  v_svt             record;
  v_voucher_partner uuid;
BEGIN
  SELECT iv.id, iv.status, iv.expires_at, iv.merchant_id,
         iv.redemption_token_expires_at, iv.voucher_template_id, iv.rules_snapshot
    INTO v_iv
    FROM issued_vouchers iv
   WHERE iv.redemption_token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'INVALID', NULL::uuid, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_iv.redemption_token_expires_at IS NULL OR v_iv.redemption_token_expires_at < now() THEN
    RETURN QUERY SELECT false, 'INVALID', NULL::uuid, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_iv.status <> 'issued' THEN
    RETURN QUERY SELECT false, 'INVALID', NULL::uuid, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_iv.expires_at IS NOT NULL AND v_iv.expires_at < now() THEN
    RETURN QUERY SELECT false, 'INVALID', NULL::uuid, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT svt.id, svt.title, svt.voucher_type, svt.discount_percent, svt.discount_cusd,
         svt.applicable_category, svt.partner_id
    INTO v_svt
    FROM spend_voucher_templates svt
   WHERE svt.id = v_iv.voucher_template_id;

  -- merchant_id is stamped on the issued asset and is immutable for its lifetime.
  v_voucher_partner := COALESCE(v_iv.merchant_id, v_svt.partner_id);

  IF v_voucher_partner IS DISTINCT FROM p_partner_id THEN
    RETURN QUERY SELECT false, 'INVALID', NULL::uuid, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, ''::text, v_iv.id,
         CASE WHEN v_iv.rules_snapshot ? 'title'
              THEN v_iv.rules_snapshot->>'title' ELSE v_svt.title END,
         CASE WHEN v_iv.rules_snapshot ? 'voucher_type'
              THEN v_iv.rules_snapshot->>'voucher_type' ELSE v_svt.voucher_type END,
         CASE WHEN v_iv.rules_snapshot ? 'discount_percent'
              THEN NULLIF(v_iv.rules_snapshot->>'discount_percent', '')::numeric
              ELSE v_svt.discount_percent END,
         CASE WHEN v_iv.rules_snapshot ? 'discount_cusd'
              THEN NULLIF(v_iv.rules_snapshot->>'discount_cusd', '')::numeric
              ELSE v_svt.discount_cusd END,
         (SELECT p.name FROM partners p WHERE p.id = v_voucher_partner),
         CASE WHEN v_iv.rules_snapshot ? 'applicable_category'
              THEN v_iv.rules_snapshot->>'applicable_category'
              ELSE v_svt.applicable_category END,
         v_iv.redemption_token_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION inspect_voucher_presentation(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION inspect_voucher_presentation(text,uuid) FROM anon;
REVOKE ALL ON FUNCTION inspect_voucher_presentation(text,uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION inspect_voucher_presentation(text,uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — redeem_voucher_in_store_atomic
-- ══════════════════════════════════════════════════════════════════════════════
-- Atomically redeems a voucher via a merchant scan. Locks the voucher row so
-- concurrent scans (and online-order races) resolve to exactly one winner.

CREATE OR REPLACE FUNCTION redeem_voucher_in_store_atomic(
  p_token_hash         text,
  p_partner_id         uuid,
  p_merchant_user_id   uuid,
  p_external_reference text DEFAULT NULL
)
RETURNS TABLE (ok boolean, voucher_id uuid, offer_title text, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iv              record;
  v_svt             record;
  v_voucher_partner uuid;
  v_discount        numeric;
  v_title           text;
  v_type            text;
  v_percent         numeric;
  v_fixed           numeric;
BEGIN
  SELECT iv.id, iv.status, iv.expires_at, iv.hub_user_id, iv.user_address,
         iv.merchant_id, iv.redemption_token_expires_at,
         iv.voucher_template_id, iv.rules_snapshot
    INTO v_iv
    FROM issued_vouchers iv
   WHERE iv.redemption_token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID'::text;
    RETURN;
  END IF;

  IF v_iv.redemption_token_expires_at IS NULL OR v_iv.redemption_token_expires_at < now() THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID'::text;
    RETURN;
  END IF;

  IF v_iv.status <> 'issued' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID'::text;
    RETURN;
  END IF;

  IF v_iv.expires_at IS NOT NULL AND v_iv.expires_at < now() THEN
    UPDATE issued_vouchers
       SET status = 'expired'
     WHERE id = v_iv.id;
    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
    VALUES (v_iv.id, 'expired', p_merchant_user_id::text,
            jsonb_build_object('reason', 'expired_at_redemption'));
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID'::text;
    RETURN;
  END IF;

  SELECT svt.id, svt.title, svt.voucher_type, svt.discount_percent,
         svt.discount_cusd, svt.partner_id
    INTO v_svt
    FROM spend_voucher_templates svt
   WHERE svt.id = v_iv.voucher_template_id;

  v_voucher_partner := COALESCE(v_iv.merchant_id, v_svt.partner_id);

  IF v_voucher_partner IS DISTINCT FROM p_partner_id THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'INVALID'::text;
    RETURN;
  END IF;

  v_title := CASE WHEN v_iv.rules_snapshot ? 'title'
                  THEN v_iv.rules_snapshot->>'title' ELSE v_svt.title END;
  v_type := CASE WHEN v_iv.rules_snapshot ? 'voucher_type'
                 THEN v_iv.rules_snapshot->>'voucher_type' ELSE v_svt.voucher_type END;
  v_percent := CASE WHEN v_iv.rules_snapshot ? 'discount_percent'
                    THEN NULLIF(v_iv.rules_snapshot->>'discount_percent', '')::numeric
                    ELSE v_svt.discount_percent END;
  v_fixed := CASE WHEN v_iv.rules_snapshot ? 'discount_cusd'
                  THEN NULLIF(v_iv.rules_snapshot->>'discount_cusd', '')::numeric
                  ELSE v_svt.discount_cusd END;

  -- discount_applied is monetary. A merchant scan has no order total, so a
  -- percentage benefit cannot be converted into money here.
  v_discount := CASE WHEN v_type IN ('fixed', 'fixed_off') THEN COALESCE(v_fixed, 0) ELSE 0 END;

  UPDATE issued_vouchers
     SET status     = 'redeemed',
         redeemed_at = now(),
         redemption_token_hash       = NULL,
         redemption_token_expires_at = NULL,
         redemption_token_issued_at  = NULL
   WHERE id = v_iv.id;

  INSERT INTO voucher_redemptions (
    issued_voucher_id, hub_user_id, user_address, merchant_id,
    discount_applied, redemption_channel, merchant_user_id, external_reference
  ) VALUES (
    v_iv.id, v_iv.hub_user_id, v_iv.user_address, p_partner_id,
    v_discount, 'merchant_scan', p_merchant_user_id, p_external_reference
  );

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (
    v_iv.id, 'redeemed', p_merchant_user_id::text,
    jsonb_build_object('merchant_id', p_partner_id, 'channel', 'merchant_scan',
                       'external_reference', p_external_reference,
                       'voucher_type', v_type,
                       'discount_percent', v_percent,
                       'discount_cusd', v_fixed)
  );

  INSERT INTO merchant_audit_log (merchant_user_id, partner_id, action, metadata)
  VALUES (
    p_merchant_user_id, p_partner_id, 'voucher.redeemed',
    jsonb_build_object('voucher_id', v_iv.id, 'channel', 'merchant_scan',
                       'external_reference', p_external_reference)
  );

  RETURN QUERY SELECT true, v_iv.id, v_title, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — merchant_grant_atomic
-- ══════════════════════════════════════════════════════════════════════════════
-- Wraps issue_voucher_from_program + a production-schema audit row in one txn.

CREATE OR REPLACE FUNCTION merchant_grant_atomic(
  p_program_id        uuid,
  p_merchant_user_id  uuid,
  p_partner_id        uuid,
  p_recipient_address text,
  p_hub_user_id       uuid,
  p_code              text,
  p_source_ref        text
)
RETURNS TABLE (ok boolean, voucher_id uuid, code text, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result          record;
  v_program_partner uuid;
  v_already_issued  boolean;
BEGIN
  SELECT svt.partner_id
    INTO v_program_partner
    FROM voucher_programs vp
    JOIN spend_voucher_templates svt ON svt.id = vp.template_id
   WHERE vp.id = p_program_id
   FOR UPDATE OF vp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_program_partner IS DISTINCT FROM p_partner_id THEN
    RAISE EXCEPTION 'PROGRAM_PARTNER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM issued_vouchers
     WHERE program_id = p_program_id
       AND acquisition_source = 'merchant_grant'
       AND source_ref = p_source_ref
  ) INTO v_already_issued;

  SELECT r.ok, r.voucher_id, r.code, r.error_code INTO v_result
  FROM issue_voucher_from_program(
    p_program_id,
    'merchant_grant',
    p_source_ref,
    p_recipient_address,
    p_hub_user_id,
    p_code,
    jsonb_build_object('grant_type', 'merchant_grant', 'granted_by', p_merchant_user_id),
    p_merchant_user_id::text
  ) r;

  IF NOT v_already_issued THEN
    INSERT INTO merchant_audit_log (merchant_user_id, partner_id, action, metadata)
    VALUES (
      p_merchant_user_id, v_program_partner, 'voucher.merchant_granted',
      jsonb_build_object(
        'program_id', p_program_id,
        'voucher_id', v_result.voucher_id,
        'recipient',  COALESCE(p_hub_user_id::text, lower(p_recipient_address))
      )
    );
  END IF;

  RETURN QUERY SELECT v_result.ok, v_result.voucher_id, v_result.code, v_result.error_code;
END;
$$;

REVOKE ALL ON FUNCTION merchant_grant_atomic(uuid,uuid,uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION merchant_grant_atomic(uuid,uuid,uuid,text,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION merchant_grant_atomic(uuid,uuid,uuid,text,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION merchant_grant_atomic(uuid,uuid,uuid,text,uuid,text,text) TO service_role;
