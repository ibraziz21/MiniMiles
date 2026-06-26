-- 001_voucher_platform_phase1.sql  (Phase 1 audit-corrected rewrite)
-- Unified Voucher Platform — additive, idempotent migration.
--
-- Prerequisites (must already exist in live Supabase):
--   • issued_vouchers           (core table, existing)
--   • spend_voucher_templates   (from merchant_transactions_dashboard_upgrade.sql)
--     !! column is partner_id, NOT merchant_id !!
--   • merchant_transactions     (existing order table)
--   • merchant_products         (from merchant store schema)
--   • auth.users                (Supabase built-in)
--
-- Audit corrections applied:
--   #1  Fixed every spend_voucher_templates.merchant_id ref → partner_id
--   #2  Added uq_iv_code, uq_iv_idempotency_key, uq_mt_payment_ref; RLS on every
--       new table + voucher_issue_nonces; append-only trigger on voucher_events
--   #3  Added burn_idempotency_key, burn_ref to issued_vouchers for burn recovery
--   #4  (addressed in issuance.ts idempotency check — no SQL change needed)
--   #5  expires_at set from template at issuance; removed misleading issued_count
--   #6  New claim_voucher_atomic RPC (atomic CAS + claimed_at)
--   #7  New mpesa_stk_requests / mpesa_stk_results tables; payment_ref unique idx
--   #8  New place_hub_order_and_redeem_voucher RPC (atomic order + redemption)
--   #9  (addressed in orders route — all wallets fetched in TS)
--   #10 (addressed in integration test file)
--
-- Re-run safe: all DDL uses IF NOT EXISTS / IF EXISTS guards.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — M-Pesa server-recorded callback tables  (#7 fix)
-- ══════════════════════════════════════════════════════════════════════════════
-- mpesa_stk_requests: every STK push we initiate (server-side record)
-- mpesa_stk_results:  Daraja callbacks received (authoritative payment evidence)

CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checkout_request_id   text        NOT NULL UNIQUE,
  phone                 text        NOT NULL,
  amount_kes            integer     NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

CREATE INDEX IF NOT EXISTS idx_mstk_req_user ON mpesa_stk_requests (hub_user_id);
CREATE INDEX IF NOT EXISTS idx_mstk_req_exp  ON mpesa_stk_requests (expires_at);

ALTER TABLE mpesa_stk_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpesa_stk_requests_deny_anon ON mpesa_stk_requests;
CREATE POLICY mpesa_stk_requests_deny_anon
  ON mpesa_stk_requests FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS mpesa_stk_requests_deny_auth ON mpesa_stk_requests;
CREATE POLICY mpesa_stk_requests_deny_auth
  ON mpesa_stk_requests FOR ALL TO authenticated USING (false) WITH CHECK (false);


CREATE TABLE IF NOT EXISTS mpesa_stk_results (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_request_id   text        NOT NULL UNIQUE,
  result_code           text        NOT NULL,
  receipt_number        text,
  amount_kes            numeric,
  phone                 text,
  raw                   jsonb,
  received_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mstk_res_cid ON mpesa_stk_results (checkout_request_id);

ALTER TABLE mpesa_stk_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpesa_stk_results_deny_anon ON mpesa_stk_results;
CREATE POLICY mpesa_stk_results_deny_anon
  ON mpesa_stk_results FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS mpesa_stk_results_deny_auth ON mpesa_stk_results;
CREATE POLICY mpesa_stk_results_deny_auth
  ON mpesa_stk_results FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — voucher_issue_nonces + RLS  (#2 fix)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_issue_nonces (
  nonce        text        PRIMARY KEY,
  user_address text        NOT NULL,
  used_at      timestamptz NOT NULL DEFAULT now()
);

-- Live deployments may already have this table from the earlier React app
-- flow without the used_at column. CREATE TABLE IF NOT EXISTS does not evolve
-- an existing table, so add the column explicitly before creating its index.
ALTER TABLE voucher_issue_nonces
  ADD COLUMN IF NOT EXISTS used_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_vin_nonce  ON voucher_issue_nonces (nonce);
CREATE INDEX        IF NOT EXISTS idx_vin_used_at ON voucher_issue_nonces (used_at);

ALTER TABLE voucher_issue_nonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vin_deny_anon ON voucher_issue_nonces;
CREATE POLICY vin_deny_anon
  ON voucher_issue_nonces FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vin_deny_auth ON voucher_issue_nonces;
CREATE POLICY vin_deny_auth
  ON voucher_issue_nonces FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — voucher_programs  (#5 fix: no issued_count — counter wired in Phase 2)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_programs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid        NOT NULL REFERENCES spend_voucher_templates(id) ON DELETE RESTRICT,
  name          text        NOT NULL,
  sponsor       text,
  funding_type  text        NOT NULL DEFAULT 'miles'
                            CHECK (funding_type IN ('miles','akiba','sponsor','free')),
  total_cap     integer     CHECK (total_cap IS NULL OR total_cap > 0),
  -- issued_count intentionally omitted until atomic increment is wired in Phase 2
  channel_caps  jsonb,
  start_at      timestamptz,
  end_at        timestamptz,
  state         text        NOT NULL DEFAULT 'draft'
                            CHECK (state IN ('draft','active','paused','ended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vp_template_id ON voucher_programs (template_id);
CREATE INDEX IF NOT EXISTS idx_vp_state       ON voucher_programs (state);

ALTER TABLE voucher_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vp_deny_anon ON voucher_programs;
CREATE POLICY vp_deny_anon
  ON voucher_programs FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vp_deny_auth ON voucher_programs;
CREATE POLICY vp_deny_auth
  ON voucher_programs FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — voucher_program_channel_allocations  (#5 fix: no issued_count)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_program_channel_allocations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    uuid        NOT NULL REFERENCES voucher_programs(id) ON DELETE CASCADE,
  channel       text        NOT NULL
                            CHECK (channel IN (
                              'miles_purchase','claw','raffle',
                              'giveaway','akiba_grant','merchant_grant'
                            )),
  cap           integer     CHECK (cap IS NULL OR cap > 0),
  -- issued_count intentionally omitted until atomic increment is wired in Phase 2
  active        boolean     NOT NULL DEFAULT true,
  UNIQUE (program_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_vpca_program_id ON voucher_program_channel_allocations (program_id);

ALTER TABLE voucher_program_channel_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vpca_deny_anon ON voucher_program_channel_allocations;
CREATE POLICY vpca_deny_anon
  ON voucher_program_channel_allocations FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vpca_deny_auth ON voucher_program_channel_allocations;
CREATE POLICY vpca_deny_auth
  ON voucher_program_channel_allocations FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — reconciliation_incidents  (#8 fix)
-- ══════════════════════════════════════════════════════════════════════════════
-- Written when an external payment boundary prevents full DB atomicity.

CREATE TABLE IF NOT EXISTS reconciliation_incidents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text        NOT NULL,
  voucher_id  uuid        REFERENCES issued_vouchers(id),
  order_id    text,
  data        jsonb,
  resolved    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ri_type       ON reconciliation_incidents (type);
CREATE INDEX IF NOT EXISTS idx_ri_resolved   ON reconciliation_incidents (resolved) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_ri_voucher_id ON reconciliation_incidents (voucher_id) WHERE voucher_id IS NOT NULL;

ALTER TABLE reconciliation_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ri_deny_anon ON reconciliation_incidents;
CREATE POLICY ri_deny_anon
  ON reconciliation_incidents FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ri_deny_auth ON reconciliation_incidents;
CREATE POLICY ri_deny_auth
  ON reconciliation_incidents FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Extend issued_vouchers  (#2, #3, #5, #6 fixes)
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a. Acquisition / ownership / lifecycle columns
ALTER TABLE issued_vouchers
  ADD COLUMN IF NOT EXISTS program_id            uuid        REFERENCES voucher_programs(id),
  ADD COLUMN IF NOT EXISTS hub_user_id           uuid        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS acquisition_source    text        NOT NULL DEFAULT 'miles_purchase',
  ADD COLUMN IF NOT EXISTS source_ref            text,
  ADD COLUMN IF NOT EXISTS sponsor               text,
  ADD COLUMN IF NOT EXISTS funding_type          text        NOT NULL DEFAULT 'miles',
  ADD COLUMN IF NOT EXISTS rules_snapshot        jsonb,
  -- Preserves any pre-Phase-1 rules_snapshot value when its legacy type is
  -- incompatible with the canonical JSONB object used by the Hub.
  ADD COLUMN IF NOT EXISTS legacy_rules_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS redemption_token_hash text,
  -- #5 fix: expires_at set at issuance from template (add if not already on table)
  ADD COLUMN IF NOT EXISTS expires_at            timestamptz,
  -- redeemed_at used in redemption finalization (add if not already on table)
  ADD COLUMN IF NOT EXISTS redeemed_at           timestamptz,
  -- #6 fix: claimed_at for stale-claim recovery (not created_at)
  ADD COLUMN IF NOT EXISTS claimed_at            timestamptz,
  -- #3 fix: burn recovery fields
  ADD COLUMN IF NOT EXISTS burn_idempotency_key  text,
  ADD COLUMN IF NOT EXISTS burn_ref              text,
  ADD COLUMN IF NOT EXISTS recovery_state        text;

-- Live schema drift: some deployments already have rules_snapshot as text[].
-- CREATE COLUMN IF NOT EXISTS cannot change that type. Preserve the old value,
-- normalize the canonical column to JSONB, then Section 14 backfills it from
-- spend_voucher_templates. This block also handles any other non-JSONB legacy
-- type without discarding its original representation.
DO $$
DECLARE
  v_rules_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_rules_type
    FROM pg_attribute a
   WHERE a.attrelid = 'issued_vouchers'::regclass
     AND a.attname = 'rules_snapshot'
     AND NOT a.attisdropped;

  IF v_rules_type IS NOT NULL AND v_rules_type <> 'jsonb' THEN
    EXECUTE format(
      'UPDATE issued_vouchers
          SET legacy_rules_snapshot = COALESCE(
                legacy_rules_snapshot,
                jsonb_build_object(
                  ''original_type'', %L,
                  ''value'', to_jsonb(rules_snapshot)
                )
              )
        WHERE rules_snapshot IS NOT NULL',
      v_rules_type
    );

    ALTER TABLE issued_vouchers
      ALTER COLUMN rules_snapshot DROP DEFAULT,
      ALTER COLUMN rules_snapshot DROP NOT NULL;

    ALTER TABLE issued_vouchers
      ALTER COLUMN rules_snapshot TYPE jsonb
      USING NULL::jsonb;
  END IF;
END $$;

-- 5b. Domain constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_iv_acquisition_source'
      AND conrelid = 'issued_vouchers'::regclass
  ) THEN
    ALTER TABLE issued_vouchers
      ADD CONSTRAINT chk_iv_acquisition_source
        CHECK (acquisition_source IN (
          'miles_purchase','claw','raffle','giveaway','akiba_grant','merchant_grant'
        ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_iv_funding_type'
      AND conrelid = 'issued_vouchers'::regclass
  ) THEN
    ALTER TABLE issued_vouchers
      ADD CONSTRAINT chk_iv_funding_type
        CHECK (funding_type IN ('miles','akiba','sponsor','free'));
  END IF;
END $$;

-- Extend status enum to include 'claiming' and 'expired'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'issued_vouchers_status_check'
      AND conrelid = 'issued_vouchers'::regclass
  ) THEN
    ALTER TABLE issued_vouchers DROP CONSTRAINT issued_vouchers_status_check;
  END IF;

  ALTER TABLE issued_vouchers
    ADD CONSTRAINT issued_vouchers_status_check
      CHECK (status IN ('pending','issued','claiming','redeemed','void','expired'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5c. Uniqueness constraints  (#2 fix)
-- Active voucher codes must be unique (void/expired rows allowed to share codes)
CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_code
  ON issued_vouchers (code)
  WHERE status NOT IN ('void','expired');

-- Client-supplied idempotency keys scoped globally (ownership checked in app layer)
CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_idempotency_key
  ON issued_vouchers (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- source_ref (claw/raffle win ID etc.) must be unique per acquisition channel
CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_source_ref
  ON issued_vouchers (acquisition_source, source_ref)
  WHERE source_ref IS NOT NULL;

-- 5d. Supporting indexes
CREATE INDEX IF NOT EXISTS idx_iv_hub_user_id ON issued_vouchers (hub_user_id)
  WHERE hub_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iv_program_id  ON issued_vouchers (program_id)
  WHERE program_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iv_status      ON issued_vouchers (status);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — merchant_transactions: unique payment_ref  (#2, #7 fix)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_mt_payment_ref
  ON merchant_transactions (payment_ref)
  WHERE payment_ref IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — voucher_redemptions + RLS  (#2 fix)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_voucher_id   uuid          NOT NULL REFERENCES issued_vouchers(id),
  order_id            text,         -- merchant_transactions.id
  hub_user_id         uuid          REFERENCES auth.users(id),
  user_address        text,
  merchant_id         uuid,
  product_id          text,
  discount_applied    numeric(12,4) NOT NULL CHECK (discount_applied >= 0),
  redeemed_at         timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (issued_voucher_id)        -- one redemption per voucher
);

CREATE INDEX IF NOT EXISTS idx_vr_hub_user_id ON voucher_redemptions (hub_user_id) WHERE hub_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vr_merchant_id ON voucher_redemptions (merchant_id) WHERE merchant_id IS NOT NULL;

ALTER TABLE voucher_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vr_deny_anon ON voucher_redemptions;
CREATE POLICY vr_deny_anon
  ON voucher_redemptions FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vr_deny_auth ON voucher_redemptions;
CREATE POLICY vr_deny_auth
  ON voucher_redemptions FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — voucher_events: append-only audit log + RLS  (#2 fix)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_voucher_id   uuid        NOT NULL REFERENCES issued_vouchers(id),
  event_type          text        NOT NULL
                                  CHECK (event_type IN (
                                    'reserved','burn_confirmed','issued',
                                    'claimed','released','redeemed',
                                    'voided','expired','reconciled','burn_ambiguous'
                                  )),
  actor_id            text,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ve_issued_voucher_id ON voucher_events (issued_voucher_id);
CREATE INDEX IF NOT EXISTS idx_ve_event_type        ON voucher_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ve_created_at        ON voucher_events (created_at DESC);

-- Append-only enforcement: prevent UPDATE and DELETE
CREATE OR REPLACE FUNCTION fn_voucher_events_no_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'voucher_events is append-only: mutations are not permitted'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_events_no_mutation ON voucher_events;
CREATE TRIGGER trg_voucher_events_no_mutation
  BEFORE UPDATE OR DELETE ON voucher_events
  FOR EACH ROW EXECUTE FUNCTION fn_voucher_events_no_mutation();

ALTER TABLE voucher_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ve_deny_anon ON voucher_events;
CREATE POLICY ve_deny_anon
  ON voucher_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ve_deny_auth ON voucher_events;
CREATE POLICY ve_deny_auth
  ON voucher_events FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — reserve_voucher_atomic_hub  (#1, #5 fixes)
-- ══════════════════════════════════════════════════════════════════════════════
-- #1 fix: uses partner_id (not merchant_id) when querying spend_voucher_templates
-- #5 fix: sets issued_vouchers.expires_at from template.expires_at at issuance

CREATE OR REPLACE FUNCTION reserve_voucher_atomic_hub(
  p_template_id        uuid,
  p_user_address       text,
  p_merchant_id        uuid,   -- the partner UUID (matches spend_voucher_templates.partner_id)
  p_code               text,
  p_idempotency_key    text    DEFAULT NULL,
  p_hub_user_id        uuid    DEFAULT NULL,
  p_rules_snapshot     jsonb   DEFAULT NULL,
  p_acquisition_source text    DEFAULT 'miles_purchase',
  p_funding_type       text    DEFAULT 'miles'
)
RETURNS TABLE (
  voucher_id  uuid,
  code        text,
  status      text,
  miles_cost  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template        record;
  v_issued_count    bigint;
  v_cooldown_cutoff timestamptz;
  v_recent          record;
  v_voucher_id      uuid;
BEGIN
  -- 1. Advisory lock serialises concurrent requests for this template
  PERFORM pg_advisory_xact_lock(hashtext(p_template_id::text));

  -- 2. Fetch and validate template  (#1 fix: partner_id not merchant_id)
  -- Table alias avoids "miles_cost is ambiguous" with RETURNS TABLE output column
  SELECT sn.id, sn.partner_id, sn.active, sn.expires_at, sn.global_cap,
         sn.cooldown_seconds, sn.miles_cost,
         sn.title, sn.voucher_type, sn.discount_percent, sn.discount_cusd,
         sn.applicable_category, sn.linked_product_id, sn.retail_value_cusd
    INTO v_template
    FROM spend_voucher_templates sn
   WHERE sn.id = p_template_id
     AND sn.partner_id = p_merchant_id;   -- FIX: was merchant_id

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE: template % not found for partner %',
      p_template_id, p_merchant_id USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_template.active THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE: template % is not active', p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_template.expires_at IS NOT NULL AND v_template.expires_at < now() THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE: template % has expired', p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Global cap check (advisory lock ensures linearisability)
  -- Table alias required: RETURNS TABLE output columns (status, code, miles_cost) would
  -- otherwise be ambiguous with same-named table columns in unqualified WHERE clauses.
  IF v_template.global_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_issued_count
      FROM issued_vouchers iv
     WHERE iv.voucher_template_id = p_template_id
       AND iv.status NOT IN ('void','expired');

    IF v_issued_count >= v_template.global_cap THEN
      RAISE EXCEPTION 'CAP_EXCEEDED: template % has reached its global cap of %',
        p_template_id, v_template.global_cap USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4. Per-user cooldown check
  IF v_template.cooldown_seconds IS NOT NULL AND v_template.cooldown_seconds > 0 THEN
    v_cooldown_cutoff := now() - (v_template.cooldown_seconds || ' seconds')::interval;

    SELECT iv.id INTO v_recent
      FROM issued_vouchers iv
     WHERE iv.user_address        = p_user_address
       AND iv.voucher_template_id = p_template_id
       AND iv.status NOT IN ('void','expired')
       AND iv.created_at          > v_cooldown_cutoff
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'COOLDOWN_ACTIVE: user % is in cooldown for template %',
        p_user_address, p_template_id USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 5. Insert pending voucher with hub-specific fields
  -- #1 fix: rules_snapshot stores partner_id (was: v_template.merchant_id)
  -- #5 fix: expires_at copied from template (immutable at issuance)
  INSERT INTO issued_vouchers (
    user_address,
    merchant_id,
    voucher_template_id,
    code,
    status,
    idempotency_key,
    hub_user_id,
    acquisition_source,
    funding_type,
    expires_at,
    rules_snapshot
  ) VALUES (
    p_user_address,
    p_merchant_id,
    p_template_id,
    p_code,
    'pending',
    p_idempotency_key,
    p_hub_user_id,
    p_acquisition_source,
    p_funding_type,
    v_template.expires_at,     -- #5 fix: set at issuance
    COALESCE(p_rules_snapshot, jsonb_build_object(
      'template_id',         v_template.id,
      'merchant_id',         v_template.partner_id,   -- #1 fix: was v_template.merchant_id
      'voucher_type',        v_template.voucher_type,
      'discount_percent',    v_template.discount_percent,
      'discount_cusd',       v_template.discount_cusd,
      'applicable_category', v_template.applicable_category,
      'linked_product_id',   v_template.linked_product_id,
      'retail_value_cusd',   v_template.retail_value_cusd,
      'miles_cost',          v_template.miles_cost,
      'title',               v_template.title,
      'snapshotted_at',      now()
    ))
  )
  RETURNING id INTO v_voucher_id;

  -- 6. Append reservation audit event
  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (
    v_voucher_id,
    'reserved',
    COALESCE(p_hub_user_id::text, p_user_address),
    jsonb_build_object(
      'template_id',        p_template_id,
      'acquisition_source', p_acquisition_source
    )
  );

  RETURN QUERY
    SELECT v_voucher_id, p_code, 'pending'::text, v_template.miles_cost::integer;
END;
$$;

REVOKE ALL ON FUNCTION reserve_voucher_atomic_hub(uuid,text,uuid,text,text,uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_voucher_atomic_hub(uuid,text,uuid,text,text,uuid,jsonb,text,text) FROM anon;
REVOKE ALL ON FUNCTION reserve_voucher_atomic_hub(uuid,text,uuid,text,text,uuid,jsonb,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION reserve_voucher_atomic_hub(uuid,text,uuid,text,text,uuid,jsonb,text,text) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — claim_voucher_atomic  (#6 fix: replaces application-level CAS)
-- ══════════════════════════════════════════════════════════════════════════════
-- Atomically: validates owner, status, expiry, merchant → transitions
-- issued → claiming → records claimed_at + audit event.
-- p_user_addresses: ALL wallet addresses linked to this Hub user (lowercased).

CREATE OR REPLACE FUNCTION claim_voucher_atomic(
  p_voucher_id      uuid,
  p_hub_user_id     uuid,
  p_user_addresses  text[],
  p_merchant_id     uuid
)
RETURNS TABLE (ok boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   record;
  v_merch text;
BEGIN
  -- Row-level lock prevents concurrent claims on the same voucher
  SELECT iv.* INTO v_row
    FROM issued_vouchers iv
   WHERE iv.id = p_voucher_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'VOUCHER_NOT_FOUND'::text; RETURN;
  END IF;

  IF v_row.status <> 'issued' THEN
    RETURN QUERY SELECT false, 'WRONG_STATUS'::text; RETURN;
  END IF;

  -- Expiry enforced atomically (immutable rules_snapshot set at issuance)
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    UPDATE issued_vouchers SET status = 'expired' WHERE id = p_voucher_id;
    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id)
    VALUES (p_voucher_id, 'expired',
            COALESCE(p_hub_user_id::text, p_user_addresses[1]));
    RETURN QUERY SELECT false, 'EXPIRED'::text; RETURN;
  END IF;

  -- Ownership: new rows use hub_user_id; legacy rows use user_address
  IF v_row.hub_user_id IS NOT NULL THEN
    IF p_hub_user_id IS NULL OR v_row.hub_user_id <> p_hub_user_id THEN
      RETURN QUERY SELECT false, 'WRONG_OWNER'::text; RETURN;
    END IF;
  ELSE
    IF NOT (lower(v_row.user_address) = ANY(
      SELECT lower(a) FROM unnest(p_user_addresses) AS a
    )) THEN
      RETURN QUERY SELECT false, 'WRONG_OWNER'::text; RETURN;
    END IF;
  END IF;

  -- Merchant scope (from rules_snapshot for new rows, from issued_vouchers.merchant_id for legacy)
  v_merch := COALESCE(v_row.rules_snapshot->>'merchant_id', v_row.merchant_id::text);
  IF v_merch IS NOT NULL AND v_merch <> p_merchant_id::text THEN
    RETURN QUERY SELECT false, 'WRONG_MERCHANT'::text; RETURN;
  END IF;

  -- Transition: issued → claiming, record claimed_at (#6 fix: claimed_at not created_at)
  UPDATE issued_vouchers
     SET status = 'claiming', claimed_at = now()
   WHERE id = p_voucher_id;

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (
    p_voucher_id, 'claimed',
    COALESCE(p_hub_user_id::text, p_user_addresses[1]),
    jsonb_build_object('merchant_id', p_merchant_id)
  );

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION claim_voucher_atomic(uuid,uuid,text[],uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_voucher_atomic(uuid,uuid,text[],uuid) FROM anon;
REVOKE ALL ON FUNCTION claim_voucher_atomic(uuid,uuid,text[],uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION claim_voucher_atomic(uuid,uuid,text[],uuid) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — place_hub_order_and_redeem_voucher  (#8 fix: atomic order+redemption)
-- ══════════════════════════════════════════════════════════════════════════════
-- Inserts the order row AND finalises voucher redemption in a single transaction.
-- Any exception (validation failure, DB error) rolls back BOTH.
-- Called AFTER payment is verified on the server.
--
-- Revalidates under the row lock: merchant, linked product, category, ownership,
-- expiry, and discount cap.  Uses rules_snapshot for modern rows; falls back to
-- a template JOIN for legacy rows so issued_vouchers.retail_value_cusd (which
-- may not exist on all deployments) is never referenced directly.

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
  p_merchant_id       uuid,
  p_product_id_scope  text,
  p_product_category  text,
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
    -- Template JOIN supplies legacy-row discount cap without touching
    -- issued_vouchers.retail_value_cusd, which may not exist on older schemas.
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

    -- 1c. Ownership re-check (belt-and-suspenders after claim_voucher_atomic)
    IF v_row.hub_user_id IS NOT NULL THEN
      IF p_hub_user_id IS NULL OR v_row.hub_user_id <> p_hub_user_id THEN
        RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE = 'P0001';
      END IF;
    ELSIF p_user_addresses IS NOT NULL THEN
      IF NOT (lower(v_row.user_address) = ANY(
        SELECT lower(a) FROM unnest(p_user_addresses) AS a
      )) THEN
        RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- 1d. Merchant / product / category validation under the row lock
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

    IF v_snap_merchant IS NOT NULL AND v_snap_merchant <> p_merchant_id::text THEN
      RAISE EXCEPTION 'WRONG_MERCHANT' USING ERRCODE = 'P0001';
    END IF;

    IF v_snap_product IS NOT NULL AND v_snap_product <> p_product_id_scope THEN
      RAISE EXCEPTION 'WRONG_PRODUCT' USING ERRCODE = 'P0001';
    END IF;

    IF v_snap_category IS NOT NULL AND v_snap_product IS NULL
       AND v_snap_category <> p_product_category THEN
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

    INSERT INTO voucher_redemptions (
      issued_voucher_id, order_id, hub_user_id, user_address,
      merchant_id, product_id, discount_applied, redeemed_at
    ) VALUES (
      p_voucher_id, v_order_id::text, p_hub_user_id, p_user_address,
      p_merchant_id, p_product_id_scope, p_discount_applied, now()
    );

    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
    VALUES (
      p_voucher_id, 'redeemed',
      COALESCE(p_hub_user_id::text, p_user_address),
      jsonb_build_object(
        'order_id',         v_order_id,
        'merchant_id',      p_merchant_id,
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
-- SECTION 12 — redeem_voucher_atomic  (#1 fix applied; kept for backward compat)
-- ══════════════════════════════════════════════════════════════════════════════
-- NOTE: production orders now use place_hub_order_and_redeem_voucher.
-- This function is retained so react-app and legacy callers continue to work.

CREATE OR REPLACE FUNCTION redeem_voucher_atomic(
  p_voucher_id        uuid,
  p_hub_user_id       uuid,
  p_user_address      text,
  p_merchant_id       uuid,
  p_product_id        text,
  p_product_category  text,
  p_order_id          text,
  p_discount_applied  numeric
)
RETURNS TABLE (
  ok           boolean,
  error_code   text,
  discount_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row          record;
  v_snap         jsonb;
  v_max_discount numeric;
BEGIN
  SELECT iv.*,
         sv.partner_id      AS tmpl_merchant_id,   -- #1 fix: was sv.merchant_id
         sv.linked_product_id,
         sv.applicable_category,
         sv.retail_value_cusd
    INTO v_row
    FROM issued_vouchers iv
    LEFT JOIN spend_voucher_templates sv ON sv.id = iv.voucher_template_id
   WHERE iv.id = p_voucher_id
     FOR UPDATE OF iv;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'VOUCHER_NOT_FOUND'::text, 0::numeric; RETURN;
  END IF;

  IF v_row.status <> 'claiming' THEN
    RETURN QUERY SELECT false, 'WRONG_STATUS'::text, 0::numeric; RETURN;
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    UPDATE issued_vouchers SET status = 'expired' WHERE id = p_voucher_id;
    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id)
    VALUES (p_voucher_id, 'expired', COALESCE(p_hub_user_id::text, p_user_address));
    RETURN QUERY SELECT false, 'EXPIRED'::text, 0::numeric; RETURN;
  END IF;

  IF v_row.hub_user_id IS NOT NULL THEN
    IF p_hub_user_id IS NULL OR v_row.hub_user_id <> p_hub_user_id THEN
      RETURN QUERY SELECT false, 'WRONG_OWNER'::text, 0::numeric; RETURN;
    END IF;
  ELSE
    IF lower(v_row.user_address) <> lower(p_user_address) THEN
      RETURN QUERY SELECT false, 'WRONG_OWNER'::text, 0::numeric; RETURN;
    END IF;
  END IF;

  v_snap := v_row.rules_snapshot;

  IF v_snap IS NOT NULL THEN
    IF (v_snap->>'merchant_id') IS DISTINCT FROM p_merchant_id::text THEN
      RETURN QUERY SELECT false, 'WRONG_MERCHANT'::text, 0::numeric; RETURN;
    END IF;
    IF v_snap->>'linked_product_id' IS NOT NULL
       AND (v_snap->>'linked_product_id') <> p_product_id THEN
      RETURN QUERY SELECT false, 'WRONG_PRODUCT'::text, 0::numeric; RETURN;
    END IF;
    IF v_snap->>'applicable_category' IS NOT NULL
       AND (v_snap->>'linked_product_id') IS NULL
       AND (v_snap->>'applicable_category') <> p_product_category THEN
      RETURN QUERY SELECT false, 'WRONG_CATEGORY'::text, 0::numeric; RETURN;
    END IF;
    v_max_discount := (v_snap->>'retail_value_cusd')::numeric;
  ELSE
    IF v_row.tmpl_merchant_id IS DISTINCT FROM p_merchant_id THEN
      RETURN QUERY SELECT false, 'WRONG_MERCHANT'::text, 0::numeric; RETURN;
    END IF;
    IF v_row.linked_product_id IS NOT NULL
       AND v_row.linked_product_id::text <> p_product_id THEN
      RETURN QUERY SELECT false, 'WRONG_PRODUCT'::text, 0::numeric; RETURN;
    END IF;
    IF v_row.applicable_category IS NOT NULL
       AND v_row.linked_product_id IS NULL
       AND v_row.applicable_category <> p_product_category THEN
      RETURN QUERY SELECT false, 'WRONG_CATEGORY'::text, 0::numeric; RETURN;
    END IF;
    v_max_discount := v_row.retail_value_cusd;
  END IF;

  IF v_max_discount IS NOT NULL AND p_discount_applied > v_max_discount + 0.005 THEN
    RETURN QUERY SELECT false, 'DISCOUNT_EXCEEDS_CAP'::text, 0::numeric; RETURN;
  END IF;

  UPDATE issued_vouchers
     SET status = 'redeemed', redeemed_at = now()
   WHERE id = p_voucher_id;

  INSERT INTO voucher_redemptions (
    issued_voucher_id, order_id, hub_user_id, user_address,
    merchant_id, product_id, discount_applied, redeemed_at
  ) VALUES (
    p_voucher_id, p_order_id, p_hub_user_id, p_user_address,
    p_merchant_id, p_product_id, p_discount_applied, now()
  );

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (
    p_voucher_id, 'redeemed',
    COALESCE(p_hub_user_id::text, p_user_address),
    jsonb_build_object(
      'order_id', p_order_id, 'merchant_id', p_merchant_id,
      'discount_applied', p_discount_applied
    )
  );

  RETURN QUERY SELECT true, ''::text, p_discount_applied;
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher_atomic(uuid,uuid,text,uuid,text,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION redeem_voucher_atomic(uuid,uuid,text,uuid,text,text,text,numeric) FROM anon;
REVOKE ALL ON FUNCTION redeem_voucher_atomic(uuid,uuid,text,uuid,text,text,text,numeric) FROM authenticated;
GRANT  EXECUTE ON FUNCTION redeem_voucher_atomic(uuid,uuid,text,uuid,text,text,text,numeric) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 13 — release_claimed_voucher
-- ══════════════════════════════════════════════════════════════════════════════
-- Primary overload: accepts ALL linked wallet addresses so legacy secondary-wallet
-- vouchers can be released without knowing which address was used at issuance.
-- Legacy callers (react-app etc.) use the text wrapper below.

CREATE OR REPLACE FUNCTION release_claimed_voucher(
  p_voucher_id      uuid,
  p_hub_user_id     uuid,
  p_user_addresses  text[],
  p_reason          text DEFAULT 'payment_failed'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE issued_vouchers
     SET status = 'issued', claimed_at = NULL
   WHERE id = p_voucher_id
     AND status = 'claiming'
     AND (
       hub_user_id = p_hub_user_id
       OR lower(user_address) = ANY(
         SELECT lower(a) FROM unnest(p_user_addresses) AS a
       )
     );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
    VALUES (
      p_voucher_id, 'released',
      COALESCE(p_hub_user_id::text, p_user_addresses[1]),
      jsonb_build_object('reason', p_reason)
    );
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION release_claimed_voucher(uuid,uuid,text[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_claimed_voucher(uuid,uuid,text[],text) FROM anon;
REVOKE ALL ON FUNCTION release_claimed_voucher(uuid,uuid,text[],text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION release_claimed_voucher(uuid,uuid,text[],text) TO service_role;

-- Legacy single-address wrapper — delegates to the array overload.
-- Kept so react-app, merchant-dashboard, and existing callers continue to work.
CREATE OR REPLACE FUNCTION release_claimed_voucher(
  p_voucher_id   uuid,
  p_hub_user_id  uuid,
  p_user_address text,
  p_reason       text DEFAULT 'payment_failed'
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT release_claimed_voucher(
    p_voucher_id, p_hub_user_id, ARRAY[p_user_address], p_reason
  );
$$;

REVOKE ALL ON FUNCTION release_claimed_voucher(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_claimed_voucher(uuid,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION release_claimed_voucher(uuid,uuid,text,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION release_claimed_voucher(uuid,uuid,text,text) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 14 — Backfill legacy issued_vouchers rows  (#1 fix applied)
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE issued_vouchers
   SET acquisition_source = 'miles_purchase'
 WHERE acquisition_source IS NULL OR acquisition_source = '';

UPDATE issued_vouchers
   SET funding_type = 'miles'
 WHERE funding_type IS NULL OR funding_type = '';

-- Best-effort: backfill rules_snapshot for legacy rows (partner_id fix applied)
UPDATE issued_vouchers iv
   SET rules_snapshot = jsonb_build_object(
         'template_id',         sv.id,
         'merchant_id',         sv.partner_id,   -- #1 fix: was sv.merchant_id
         'voucher_type',        sv.voucher_type,
         'discount_percent',    sv.discount_percent,
         'discount_cusd',       sv.discount_cusd,
         'applicable_category', sv.applicable_category,
         'linked_product_id',   sv.linked_product_id,
         'retail_value_cusd',   sv.retail_value_cusd,
         'miles_cost',          sv.miles_cost,
         'title',               sv.title,
         'snapshotted_at',      now()
       )
  FROM spend_voucher_templates sv
 WHERE iv.voucher_template_id = sv.id
   AND iv.rules_snapshot IS NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 16 — Constraint evolutions (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════
-- These blocks safely evolve constraints that may have been created by an older
-- version of this migration, ensuring the canonical definition is always present
-- after any fresh or incremental application.

-- 16a. issued_vouchers.recovery_state — allowed values
-- Earlier partial deployments may have omitted burn_confirmed_promote_failed.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'chk_iv_recovery_state'
     AND conrelid = 'issued_vouchers'::regclass;

  IF v_def IS NULL THEN
    ALTER TABLE issued_vouchers
      ADD CONSTRAINT chk_iv_recovery_state
        CHECK (recovery_state IS NULL OR recovery_state IN (
          'burn_ambiguous', 'burn_confirmed_promote_failed'
        ));
  ELSIF v_def NOT LIKE '%burn_confirmed_promote_failed%' THEN
    ALTER TABLE issued_vouchers DROP CONSTRAINT chk_iv_recovery_state;
    ALTER TABLE issued_vouchers
      ADD CONSTRAINT chk_iv_recovery_state
        CHECK (recovery_state IS NULL OR recovery_state IN (
          'burn_ambiguous', 'burn_confirmed_promote_failed'
        ));
  END IF;
END $$;

-- 16b. voucher_events.event_type — ensure burn_ambiguous is allowed
-- Earlier table deployments may have omitted burn_ambiguous from the CHECK list.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'voucher_events_event_type_check'
     AND conrelid = 'voucher_events'::regclass;

  IF v_def IS NOT NULL AND v_def NOT LIKE '%burn_ambiguous%' THEN
    ALTER TABLE voucher_events DROP CONSTRAINT voucher_events_event_type_check;
    ALTER TABLE voucher_events
      ADD CONSTRAINT voucher_events_event_type_check
        CHECK (event_type IN (
          'reserved','burn_confirmed','issued',
          'claimed','released','redeemed',
          'voided','expired','reconciled','burn_ambiguous'
        ));
  END IF;
END $$;


-- SECTION 15 — Reconciliation helpers (comment-only, not executed)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- (A) Vouchers stuck in 'claiming' past stale-claim window (use claimed_at, not created_at):
--
--   SELECT id, hub_user_id, claimed_at,
--          EXTRACT(EPOCH FROM (now()-claimed_at))/60 AS age_min
--     FROM issued_vouchers
--    WHERE status = 'claiming'
--      AND claimed_at < now() - interval '15 minutes'
--    ORDER BY claimed_at;
--
--   -- Release them:
--   UPDATE issued_vouchers SET status = 'issued', claimed_at = NULL
--    WHERE status = 'claiming'
--      AND claimed_at < now() - interval '15 minutes';
--
-- (B) Ambiguous burns — re-query burn API with burn_idempotency_key:
--
--   SELECT id, user_address, burn_idempotency_key, burn_ref, recovery_state, created_at
--     FROM issued_vouchers
--    WHERE recovery_state = 'burn_ambiguous'
--    ORDER BY created_at;
--
--   -- After confirming burn succeeded (burn API returns the transaction):
--   UPDATE issued_vouchers
--      SET status = 'issued', recovery_state = NULL, burn_ref = '<confirmed_ref>'
--    WHERE recovery_state = 'burn_ambiguous' AND id = '<voucher_id>';
--
--   -- After confirming burn never executed (burn API returns not-found for the key):
--   UPDATE issued_vouchers SET status = 'void', recovery_state = NULL
--    WHERE recovery_state = 'burn_ambiguous' AND id = '<voucher_id>';
--
-- (C) Burn confirmed but promote failed:
--
--   UPDATE issued_vouchers
--      SET status = 'issued', recovery_state = NULL
--    WHERE recovery_state = 'burn_confirmed_promote_failed'
--      AND status = 'pending'
--      AND burn_ref IS NOT NULL;
--
-- (D) Reconciliation incidents (order exists but voucher not fully redeemed):
--
--   SELECT * FROM reconciliation_incidents WHERE NOT resolved ORDER BY created_at;
