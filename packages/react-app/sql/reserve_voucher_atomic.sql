-- reserve_voucher_atomic.sql
-- Atomically reserves a spend voucher for issuance.
--
-- Serialization strategy:
--   pg_advisory_xact_lock(hashtext(p_template_id)) acquires an exclusive
--   session-level advisory lock for this template within the current
--   transaction. All concurrent calls for the same template_id queue here,
--   so the cap count and cooldown check are always consistent — no phantom
--   reads between SELECT count(*) and INSERT.
--
-- Called from /api/Spend/vouchers/issue after:
--   - signature verification
--   - nonce consumption (voucher_issue_nonces insert)
-- Returns a row with the new issued_vouchers entry (status = 'pending').
-- Raises application-level exceptions on violations:
--   SQLSTATE 'P0001'  message prefix  "CAP_EXCEEDED"
--   SQLSTATE 'P0001'  message prefix  "COOLDOWN_ACTIVE"
--   SQLSTATE 'P0001'  message prefix  "TEMPLATE_INACTIVE"
-- The caller maps these to HTTP 409 / 429 / 404 as appropriate.
--
-- Prerequisites:
--   - issued_vouchers table exists with columns:
--       user_address, merchant_id, voucher_template_id, code, qr_payload,
--       status, idempotency_key
--   - spend_voucher_templates table exists (see merchant_transactions_dashboard_upgrade.sql)
--
-- Run once in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION reserve_voucher_atomic(
  p_template_id       uuid,
  p_user_address      text,
  p_merchant_id       uuid,
  p_code              text,
  p_qr_payload        text,
  p_idempotency_key   text   DEFAULT NULL
)
RETURNS TABLE (
  voucher_id          uuid,
  code                text,
  qr_payload          text,
  status              text,
  miles_cost          integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template          record;
  v_issued_count      bigint;
  v_cooldown_cutoff   timestamptz;
  v_recent            record;
  v_voucher_id        uuid;
BEGIN
  -- ── 1. Acquire an exclusive advisory lock for this template ────────────────
  -- Uses hashtext() to map the UUID string to a bigint lock key.
  -- The lock is released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtext(p_template_id::text));

  -- ── 2. Fetch and validate the template ────────────────────────────────────
  SELECT id, merchant_id, active, expires_at, global_cap, cooldown_seconds, miles_cost
    INTO v_template
    FROM spend_voucher_templates
   WHERE id = p_template_id
     AND merchant_id = p_merchant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE: template % not found for merchant %',
      p_template_id, p_merchant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_template.active THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE: template % is not active', p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_template.expires_at IS NOT NULL AND v_template.expires_at < now() THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE: template % has expired', p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 3. Global cap check ────────────────────────────────────────────────────
  -- Count non-void vouchers for this template (pending + issued + claiming + redeemed).
  -- The advisory lock ensures no concurrent transaction can insert between
  -- this count and the insert below.
  IF v_template.global_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_issued_count
      FROM issued_vouchers
     WHERE voucher_template_id = p_template_id
       AND status <> 'void';

    IF v_issued_count >= v_template.global_cap THEN
      RAISE EXCEPTION 'CAP_EXCEEDED: template % has reached its global cap of %',
        p_template_id, v_template.global_cap
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 4. Per-user cooldown check ─────────────────────────────────────────────
  IF v_template.cooldown_seconds > 0 THEN
    v_cooldown_cutoff := now() - (v_template.cooldown_seconds || ' seconds')::interval;

    SELECT id INTO v_recent
      FROM issued_vouchers
     WHERE user_address        = p_user_address
       AND voucher_template_id = p_template_id
       AND status             <> 'void'
       AND created_at          > v_cooldown_cutoff
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'COOLDOWN_ACTIVE: user % is in cooldown for template %',
        p_user_address, p_template_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 5. Insert pending voucher row ──────────────────────────────────────────
  INSERT INTO issued_vouchers (
    user_address,
    merchant_id,
    voucher_template_id,
    code,
    qr_payload,
    status,
    idempotency_key
  ) VALUES (
    p_user_address,
    p_merchant_id,
    p_template_id,
    p_code,
    p_qr_payload,
    'pending',
    p_idempotency_key
  )
  RETURNING id INTO v_voucher_id;

  -- ── 6. Return the new row with template cost ───────────────────────────────
  RETURN QUERY
    SELECT v_voucher_id,
           p_code,
           p_qr_payload,
           'pending'::text,
           v_template.miles_cost;
END;
$$;

-- Grant execute to the service role (Supabase server-side API).
-- The anon and authenticated roles must NOT be able to call this directly.
REVOKE ALL ON FUNCTION reserve_voucher_atomic(uuid, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_voucher_atomic(uuid, text, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION reserve_voucher_atomic(uuid, text, uuid, text, text, text) FROM authenticated;
-- service_role has EXECUTE by default in Supabase; explicitly grant for clarity.
GRANT EXECUTE ON FUNCTION reserve_voucher_atomic(uuid, text, uuid, text, text, text) TO service_role;


-- ── Uniqueness constraints (idempotent — safe to re-run) ───────────────────────
-- These back the advisory-lock serialization with hard DB guarantees.

-- Voucher code unique across non-void rows (already in merchant_security_constraints.sql;
-- repeated here for completeness — CREATE UNIQUE INDEX IF NOT EXISTS is idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_code
  ON issued_vouchers (code)
  WHERE status <> 'void';

-- Idempotency key unique where not null
CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_idempotency_key
  ON issued_vouchers (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One pending row per (user, template) at a time guards against the edge case
-- where the nonce table is wiped but pending rows linger.
CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_pending_per_user_template
  ON issued_vouchers (user_address, voucher_template_id)
  WHERE status = 'pending';
