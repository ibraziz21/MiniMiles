-- 003_voucher_programs_phase2.sql
-- Phase 2: Unified Voucher Programs — final audit-hardened version.
-- 001 and 002 are deployed and immutable. Never modify them.
--
-- Compatibility guarantee:
--   • merchant_audit_log: uses the LIVE production schema
--     (merchant_user_id, partner_id, action, order_id, metadata).
--     No entity_type / entity_id / actor_id / old_values / new_values.
--   • CREATE TABLE IF NOT EXISTS is a no-op on Supabase prod where the table exists.
--   • All RPCs are SECURITY DEFINER, REVOKE'd from anon/authenticated, GRANT'd to service_role.
--   • reserve_with_program_atomic_hub resolves the eligible miles_purchase program from
--     the DB — callers do not supply a program_id.
-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Scoped source_ref uniqueness
-- ══════════════════════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS uq_iv_source_ref;

CREATE UNIQUE INDEX IF NOT EXISTS uq_iv_source_ref_scoped
  ON issued_vouchers (program_id, acquisition_source, source_ref)
  WHERE source_ref IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — source_ref mandatory trigger
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_iv_source_ref_required()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.acquisition_source IN (
       'claw','raffle','giveaway','merchant_grant','akiba_grant'
     ) AND (NEW.source_ref IS NULL OR trim(NEW.source_ref) = '') THEN
    RAISE EXCEPTION 'SOURCE_REF_REQUIRED for channel %', NEW.acquisition_source
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iv_source_ref_required ON issued_vouchers;
CREATE TRIGGER trg_iv_source_ref_required
  BEFORE INSERT ON issued_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_iv_source_ref_required();

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — merchant_audit_log (live production schema)
-- ══════════════════════════════════════════════════════════════════════════════
-- IMPORTANT: This table already exists in production with this exact schema.
-- CREATE TABLE IF NOT EXISTS is a no-op there.
-- In clean environments (integration tests), this creates the table for the first time.
-- Columns: merchant_user_id, partner_id, action, order_id, metadata.
-- No entity_type / entity_id / actor_id / old_values / new_values.

CREATE TABLE IF NOT EXISTS merchant_audit_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_user_id  uuid        NOT NULL,    -- FK to merchant_users exists in production
  partner_id        uuid        NOT NULL,    -- denormalised for fast per-partner queries
  action            text        NOT NULL,
  order_id          uuid,                   -- nullable; some actions are not order-specific
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mal_partner_created ON merchant_audit_log (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mal_merchant_user   ON merchant_audit_log (merchant_user_id);

ALTER TABLE merchant_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mal_deny_anon ON merchant_audit_log;
CREATE POLICY mal_deny_anon
  ON merchant_audit_log FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS mal_deny_auth ON merchant_audit_log;
CREATE POLICY mal_deny_auth
  ON merchant_audit_log FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — hub_user_wallets stub (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hub_user_wallets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecosystem   text        NOT NULL CHECK (ecosystem IN ('minipay', 'base')),
  address     text        NOT NULL,
  is_primary  boolean     NOT NULL DEFAULT false,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecosystem, address),
  UNIQUE (user_id, ecosystem)
);

CREATE INDEX IF NOT EXISTS idx_huw_user_id ON hub_user_wallets (user_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — raffle_winners
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS raffle_winners (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    bigint      NOT NULL,
  winner      text        NOT NULL,
  finalized   boolean     NOT NULL DEFAULT false,
  program_id  uuid        REFERENCES voucher_programs(id),
  contract    text,                   -- lowercased contract address
  chain_id    integer,                -- EVM chain ID
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_raffle_winner_round UNIQUE (round_id)
);

CREATE INDEX IF NOT EXISTS idx_rw_winner  ON raffle_winners (winner);
CREATE INDEX IF NOT EXISTS idx_rw_program ON raffle_winners (program_id);

ALTER TABLE raffle_winners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rw_deny_anon ON raffle_winners;
CREATE POLICY rw_deny_anon ON raffle_winners FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rw_deny_auth ON raffle_winners;
CREATE POLICY rw_deny_auth ON raffle_winners FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Allow service_role to record confirmed winners (trusted indexer path)
GRANT INSERT, UPDATE ON raffle_winners TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — voucher_program_channel_sources
-- ══════════════════════════════════════════════════════════════════════════════
-- Binds an on-chain or off-chain source to a specific program+channel.
-- Claw route loads chain_id + contract_address + allowed_reward_classes from here.
-- Raffle route loads contract + chain_id to build the canonical source_ref.

CREATE TABLE IF NOT EXISTS voucher_program_channel_sources (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            uuid    NOT NULL REFERENCES voucher_programs(id) ON DELETE CASCADE,
  channel               text    NOT NULL,
  chain_id              integer,
  contract_address      text,               -- lowercased EVM address
  campaign_id           text,               -- non-chain identifier
  allowed_reward_classes integer[],         -- claw: e.g. {2,3,4,5} = Common,Rare,Epic,Legendary
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_vpcs_program ON voucher_program_channel_sources (program_id);

ALTER TABLE voucher_program_channel_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vpcs_deny_anon ON voucher_program_channel_sources;
CREATE POLICY vpcs_deny_anon ON voucher_program_channel_sources FOR ALL TO anon   USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vpcs_deny_auth ON voucher_program_channel_sources;
CREATE POLICY vpcs_deny_auth ON voucher_program_channel_sources FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Program table CHECK constraints
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'voucher_programs' AND constraint_name = 'chk_vp_total_cap_positive'
  ) THEN
    ALTER TABLE voucher_programs
      ADD CONSTRAINT chk_vp_total_cap_positive
      CHECK (total_cap IS NULL OR total_cap > 0);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'voucher_programs' AND constraint_name = 'chk_vp_schedule'
  ) THEN
    ALTER TABLE voucher_programs
      ADD CONSTRAINT chk_vp_schedule
      CHECK (start_at IS NULL OR end_at IS NULL OR start_at < end_at);
  END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — v_program_inventory view
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_program_inventory AS
WITH prog_consumed AS (
  SELECT program_id, COUNT(*) AS consumed
  FROM issued_vouchers
  WHERE status NOT IN ('void') AND program_id IS NOT NULL
  GROUP BY program_id
),
chan_consumed AS (
  SELECT program_id, acquisition_source AS channel, COUNT(*) AS consumed
  FROM issued_vouchers
  WHERE status NOT IN ('void') AND program_id IS NOT NULL
  GROUP BY program_id, acquisition_source
)
SELECT
  vp.id                                                  AS program_id,
  vp.name                                                AS program_name,
  vp.template_id,
  vp.state,
  vp.total_cap,
  vp.funding_type,
  vp.sponsor,
  vp.start_at,
  vp.end_at,
  vpca.id                                                AS channel_id,
  vpca.channel,
  vpca.cap                                               AS channel_cap,
  vpca.active                                            AS channel_active,
  COALESCE(pc.consumed, 0)                               AS program_consumed,
  CASE WHEN vp.total_cap IS NOT NULL
       THEN GREATEST(0, vp.total_cap - COALESCE(pc.consumed, 0))
       ELSE NULL END                                     AS program_remaining,
  COALESCE(cc.consumed, 0)                               AS channel_consumed,
  CASE WHEN vpca.cap IS NOT NULL
       THEN GREATEST(0, vpca.cap - COALESCE(cc.consumed, 0))
       ELSE NULL END                                     AS channel_remaining
FROM voucher_programs vp
LEFT JOIN voucher_program_channel_allocations vpca ON vpca.program_id = vp.id
LEFT JOIN prog_consumed  pc ON pc.program_id = vp.id
LEFT JOIN chan_consumed  cc ON cc.program_id = vp.id AND cc.channel = vpca.channel;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — Program and allocation safety triggers (belt-and-suspenders)
-- ══════════════════════════════════════════════════════════════════════════════

-- 9a: state='active' requires total_cap > 0 (INSERT and UPDATE)
CREATE OR REPLACE FUNCTION fn_vp_active_requires_total_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'active' AND (NEW.total_cap IS NULL OR NEW.total_cap <= 0) THEN
    RAISE EXCEPTION 'ACTIVATION_REQUIRES_TOTAL_CAP: active program must have total_cap > 0'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vp_active_requires_total_cap ON voucher_programs;
CREATE TRIGGER trg_vp_active_requires_total_cap
  BEFORE INSERT OR UPDATE ON voucher_programs
  FOR EACH ROW EXECUTE FUNCTION fn_vp_active_requires_total_cap();

-- 9b: total_cap cannot be reduced below consumed inventory
CREATE OR REPLACE FUNCTION fn_protect_program_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_consumed bigint;
BEGIN
  IF NEW.total_cap IS NOT NULL
     AND (OLD.total_cap IS NULL OR NEW.total_cap < OLD.total_cap) THEN
    SELECT COUNT(*) INTO v_consumed
      FROM issued_vouchers
     WHERE program_id = NEW.id AND status NOT IN ('void');
    IF v_consumed > NEW.total_cap THEN
      RAISE EXCEPTION 'CAP_BELOW_CONSUMED: consumed=%, requested cap=%',
        v_consumed, NEW.total_cap USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_program_cap ON voucher_programs;
CREATE TRIGGER trg_protect_program_cap
  BEFORE UPDATE OF total_cap ON voucher_programs
  FOR EACH ROW EXECUTE FUNCTION fn_protect_program_cap();

-- 9c: total_cap cannot be reduced below sum of active allocation caps
CREATE OR REPLACE FUNCTION fn_vp_total_cap_ge_alloc_sum()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_alloc_sum bigint;
BEGIN
  IF NEW.total_cap IS NOT NULL
     AND (OLD.total_cap IS NULL OR NEW.total_cap < OLD.total_cap) THEN
    SELECT COALESCE(SUM(cap), 0) INTO v_alloc_sum
      FROM voucher_program_channel_allocations
     WHERE program_id = NEW.id AND active = true AND cap IS NOT NULL;
    IF v_alloc_sum > NEW.total_cap THEN
      RAISE EXCEPTION 'TOTAL_CAP_BELOW_ALLOC_SUM: alloc_sum=%, new_cap=%',
        v_alloc_sum, NEW.total_cap USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vp_total_cap_ge_alloc_sum ON voucher_programs;
CREATE TRIGGER trg_vp_total_cap_ge_alloc_sum
  BEFORE UPDATE OF total_cap ON voucher_programs
  FOR EACH ROW EXECUTE FUNCTION fn_vp_total_cap_ge_alloc_sum();

-- 9d: template cannot change after consumed inventory exists
CREATE OR REPLACE FUNCTION fn_protect_program_template()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.template_id <> OLD.template_id THEN
    IF EXISTS (
      SELECT 1 FROM issued_vouchers
       WHERE program_id = NEW.id AND status NOT IN ('void')
       LIMIT 1
    ) THEN
      RAISE EXCEPTION 'TEMPLATE_CHANGE_AFTER_ISSUANCE' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_program_template ON voucher_programs;
CREATE TRIGGER trg_protect_program_template
  BEFORE UPDATE OF template_id ON voucher_programs
  FOR EACH ROW EXECUTE FUNCTION fn_protect_program_template();

-- 9e: active allocation requires cap > 0 (allocation INSERT and UPDATE)
CREATE OR REPLACE FUNCTION fn_vpca_active_requires_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.active, false) AND (NEW.cap IS NULL OR NEW.cap <= 0) THEN
    RAISE EXCEPTION 'ACTIVE_ALLOCATION_REQUIRES_POSITIVE_CAP: channel=%', NEW.channel
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vpca_active_requires_cap ON voucher_program_channel_allocations;
CREATE TRIGGER trg_vpca_active_requires_cap
  BEFORE INSERT OR UPDATE ON voucher_program_channel_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_vpca_active_requires_cap();

-- 9f: channel cap cannot be reduced below channel consumption
CREATE OR REPLACE FUNCTION fn_protect_channel_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_consumed bigint;
BEGIN
  IF NEW.cap IS NOT NULL AND (OLD.cap IS NULL OR NEW.cap < OLD.cap) THEN
    SELECT COUNT(*) INTO v_consumed
      FROM issued_vouchers
     WHERE program_id        = NEW.program_id
       AND acquisition_source = NEW.channel
       AND status NOT IN ('void');
    IF v_consumed > NEW.cap THEN
      RAISE EXCEPTION 'CHANNEL_CAP_BELOW_CONSUMED: consumed=%, requested cap=%',
        v_consumed, NEW.cap USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_channel_cap ON voucher_program_channel_allocations;
CREATE TRIGGER trg_protect_channel_cap
  BEFORE UPDATE OF cap ON voucher_program_channel_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_protect_channel_cap();

-- 9g: preserve invariants on allocation INSERT/UPDATE/DELETE.
-- Cap-sum check applies to ALL program states (draft, active, paused).
-- Last-channel and deactivation guards apply only to ACTIVE programs.
CREATE OR REPLACE FUNCTION fn_vpca_preserve_active_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_program     record;
  v_alloc_sum   bigint;
  v_alloc_count integer;
BEGIN
  SELECT id, state, total_cap INTO v_program
  FROM voucher_programs WHERE id = COALESCE(NEW.program_id, OLD.program_id);

  -- Cap-sum check: active allocation cap sum must not exceed total_cap.
  -- Runs for INSERT and UPDATE regardless of program state.
  IF TG_OP <> 'DELETE'
     AND COALESCE(NEW.active, false)
     AND NEW.cap IS NOT NULL
     AND FOUND
     AND v_program.total_cap IS NOT NULL
  THEN
    SELECT COALESCE(SUM(cap), 0) INTO v_alloc_sum
    FROM voucher_program_channel_allocations
    WHERE program_id = NEW.program_id AND active = true AND cap IS NOT NULL
      AND id IS DISTINCT FROM NEW.id;
    v_alloc_sum := v_alloc_sum + NEW.cap;
    IF v_alloc_sum > v_program.total_cap THEN
      RAISE EXCEPTION 'CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP: sum=%, total=%',
        v_alloc_sum, v_program.total_cap USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Guards below only apply to active programs.
  IF NOT FOUND OR v_program.state <> 'active' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT COUNT(*) INTO v_alloc_count
    FROM voucher_program_channel_allocations
    WHERE program_id = OLD.program_id AND active = true AND id <> OLD.id;
    IF v_alloc_count = 0 THEN
      RAISE EXCEPTION 'CANNOT_REMOVE_LAST_ACTIVE_CHANNEL: program would have no active channels'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- On deactivate: check remaining active allocations
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.active, false) = true AND COALESCE(NEW.active, false) = false THEN
    SELECT COUNT(*) INTO v_alloc_count
    FROM voucher_program_channel_allocations
    WHERE program_id = NEW.program_id AND active = true AND id <> NEW.id;
    IF v_alloc_count = 0 THEN
      RAISE EXCEPTION 'CANNOT_DEACTIVATE_LAST_ACTIVE_CHANNEL: program would have no active channels'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vpca_preserve_active_invariants ON voucher_program_channel_allocations;
CREATE TRIGGER trg_vpca_preserve_active_invariants
  BEFORE INSERT OR UPDATE OR DELETE ON voucher_program_channel_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_vpca_preserve_active_invariants();

-- 9h: deleting a channel allocation with consumed inventory is rejected
CREATE OR REPLACE FUNCTION fn_vpca_reject_consumed_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_consumed bigint;
BEGIN
  SELECT COUNT(*) INTO v_consumed
  FROM issued_vouchers
  WHERE program_id        = OLD.program_id
    AND acquisition_source = OLD.channel
    AND status NOT IN ('void');
  IF v_consumed > 0 THEN
    RAISE EXCEPTION 'CANNOT_DELETE_CHANNEL_WITH_CONSUMPTION: channel=%, consumed=%',
      OLD.channel, v_consumed USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_vpca_reject_consumed_delete ON voucher_program_channel_allocations;
CREATE TRIGGER trg_vpca_reject_consumed_delete
  BEFORE DELETE ON voucher_program_channel_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_vpca_reject_consumed_delete();

-- 9i: channel name cannot be changed after consumption exists
CREATE OR REPLACE FUNCTION fn_vpca_reject_channel_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_consumed bigint;
BEGIN
  IF NEW.channel <> OLD.channel THEN
    SELECT COUNT(*) INTO v_consumed
    FROM issued_vouchers
    WHERE program_id        = OLD.program_id
      AND acquisition_source = OLD.channel
      AND status NOT IN ('void');
    IF v_consumed > 0 THEN
      RAISE EXCEPTION 'CANNOT_CHANGE_CHANNEL_WITH_CONSUMPTION: channel=%, consumed=%',
        OLD.channel, v_consumed USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vpca_reject_channel_change ON voucher_program_channel_allocations;
CREATE TRIGGER trg_vpca_reject_channel_change
  BEFORE UPDATE OF channel ON voucher_program_channel_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_vpca_reject_channel_change();

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — create_voucher_program
-- ══════════════════════════════════════════════════════════════════════════════
-- Atomic creation: program + channel allocations + audit entry.
-- Audit uses the live production merchant_audit_log schema.

DROP FUNCTION IF EXISTS create_voucher_program(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,text);

CREATE OR REPLACE FUNCTION create_voucher_program(
  p_name              text,
  p_template_id       uuid,
  p_funding_type      text,
  p_sponsor           text,
  p_total_cap         integer,
  p_start_at          timestamptz,
  p_end_at            timestamptz,
  p_channels          jsonb,            -- [{channel, cap, active}]
  p_merchant_user_id  uuid,
  p_partner_id        uuid
)
RETURNS TABLE (ok boolean, program_id uuid, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id     uuid;
  v_ch             record;
  v_cap_sum        bigint := 0;
  v_valid_channels text[] := ARRAY['miles_purchase','claw','raffle','giveaway','merchant_grant','akiba_grant'];
  v_valid_funding  text[] := ARRAY['miles','akiba','sponsor','free'];
BEGIN
  IF trim(COALESCE(p_name,'')) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM spend_voucher_templates WHERE id = p_template_id) THEN
    RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (p_funding_type = ANY(v_valid_funding)) THEN
    RAISE EXCEPTION 'INVALID_FUNDING_TYPE: %', p_funding_type USING ERRCODE = 'P0001';
  END IF;
  IF p_total_cap IS NOT NULL AND p_total_cap <= 0 THEN
    RAISE EXCEPTION 'INVALID_TOTAL_CAP: must be positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_at IS NOT NULL AND p_end_at IS NOT NULL AND p_start_at >= p_end_at THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: start_at must be before end_at' USING ERRCODE = 'P0001';
  END IF;

  FOR v_ch IN SELECT * FROM jsonb_to_recordset(COALESCE(p_channels,'[]'::jsonb))
                AS t(channel text, cap integer, active boolean)
  LOOP
    IF NOT (v_ch.channel = ANY(v_valid_channels)) THEN
      RAISE EXCEPTION 'INVALID_CHANNEL: %', v_ch.channel USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_ch.active, true) AND (v_ch.cap IS NULL OR v_ch.cap <= 0) THEN
      RAISE EXCEPTION 'ACTIVE_CHANNEL_MUST_HAVE_POSITIVE_CAP: %', v_ch.channel
        USING ERRCODE = 'P0001';
    END IF;
    IF v_ch.cap IS NOT NULL THEN
      v_cap_sum := v_cap_sum + v_ch.cap;
    END IF;
  END LOOP;

  IF p_total_cap IS NOT NULL AND v_cap_sum > p_total_cap THEN
    RAISE EXCEPTION 'CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP: sum=%, total=%',
      v_cap_sum, p_total_cap USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO voucher_programs (
    name, template_id, funding_type, sponsor, total_cap, start_at, end_at, state
  ) VALUES (
    p_name, p_template_id, p_funding_type, p_sponsor, p_total_cap, p_start_at, p_end_at, 'draft'
  )
  RETURNING id INTO v_program_id;

  FOR v_ch IN SELECT * FROM jsonb_to_recordset(COALESCE(p_channels,'[]'::jsonb))
                AS t(channel text, cap integer, active boolean)
  LOOP
    INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
    VALUES (v_program_id, v_ch.channel, v_ch.cap, COALESCE(v_ch.active, true));
  END LOOP;

  INSERT INTO merchant_audit_log (merchant_user_id, partner_id, action, metadata)
  VALUES (
    p_merchant_user_id,
    p_partner_id,
    'program.created',
    jsonb_build_object(
      'program_id',  v_program_id,
      'name',        p_name,
      'template_id', p_template_id,
      'total_cap',   p_total_cap,
      'state',       'draft'
    )
  );

  RETURN QUERY SELECT true, v_program_id, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION create_voucher_program(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,uuid,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_voucher_program(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,uuid,uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — update_voucher_program
-- ══════════════════════════════════════════════════════════════════════════════
-- Atomic draft editing: name, dates, total_cap, template (pre-issuance),
-- channel upserts and removals. Single audit row per call.

CREATE OR REPLACE FUNCTION update_voucher_program(
  p_program_id        uuid,
  p_merchant_user_id  uuid,
  p_partner_id        uuid,
  p_name              text         DEFAULT NULL,
  p_start_at          timestamptz  DEFAULT NULL,
  p_end_at            timestamptz  DEFAULT NULL,
  p_total_cap         integer      DEFAULT NULL,
  p_template_id       uuid         DEFAULT NULL,
  p_channel_patches   jsonb        DEFAULT NULL,  -- [{channel,cap,active,remove?}]
  p_clear_end_at      boolean      DEFAULT false,
  p_clear_start_at    boolean      DEFAULT false
)
RETURNS TABLE (ok boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program  record;
  v_patch    record;
  v_consumed bigint;
  v_changes  jsonb := '{}'::jsonb;
BEGIN
  SELECT id, state, name, template_id, total_cap, start_at, end_at INTO v_program
  FROM voucher_programs WHERE id = p_program_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_program.state <> 'draft' THEN
    RAISE EXCEPTION 'EDIT_ONLY_IN_DRAFT: state=%', v_program.state USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NOT NULL THEN
    IF trim(p_name) = '' THEN RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0001'; END IF;
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', v_program.name, 'new', p_name));
    UPDATE voucher_programs SET name = p_name, updated_at = now() WHERE id = p_program_id;
  END IF;

  IF p_start_at IS NOT NULL OR p_clear_start_at THEN
    v_changes := v_changes || jsonb_build_object('start_at', jsonb_build_object('old', v_program.start_at, 'new', p_start_at));
    UPDATE voucher_programs SET start_at = p_start_at, updated_at = now() WHERE id = p_program_id;
  END IF;

  IF p_end_at IS NOT NULL OR p_clear_end_at THEN
    v_changes := v_changes || jsonb_build_object('end_at', jsonb_build_object('old', v_program.end_at, 'new', p_end_at));
    UPDATE voucher_programs SET end_at = p_end_at, updated_at = now() WHERE id = p_program_id;
  END IF;

  IF p_total_cap IS NOT NULL THEN
    v_changes := v_changes || jsonb_build_object('total_cap', jsonb_build_object('old', v_program.total_cap, 'new', p_total_cap));
    UPDATE voucher_programs SET total_cap = p_total_cap, updated_at = now() WHERE id = p_program_id;
  END IF;

  IF p_template_id IS NOT NULL AND p_template_id IS DISTINCT FROM v_program.template_id THEN
    IF NOT EXISTS (SELECT 1 FROM spend_voucher_templates WHERE id = p_template_id) THEN
      RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM issued_vouchers WHERE program_id = p_program_id AND status NOT IN ('void') LIMIT 1
    ) THEN
      RAISE EXCEPTION 'TEMPLATE_CHANGE_AFTER_ISSUANCE' USING ERRCODE = 'P0001';
    END IF;
    v_changes := v_changes || jsonb_build_object('template_id', jsonb_build_object('old', v_program.template_id, 'new', p_template_id));
    UPDATE voucher_programs SET template_id = p_template_id, updated_at = now() WHERE id = p_program_id;
  END IF;

  IF p_channel_patches IS NOT NULL THEN
    FOR v_patch IN SELECT * FROM jsonb_to_recordset(p_channel_patches)
                    AS t(channel text, cap integer, active boolean, remove boolean)
    LOOP
      IF COALESCE(v_patch.remove, false) THEN
        SELECT COUNT(*) INTO v_consumed
        FROM issued_vouchers
        WHERE program_id = p_program_id AND acquisition_source = v_patch.channel AND status NOT IN ('void');
        IF v_consumed > 0 THEN
          RAISE EXCEPTION 'CANNOT_REMOVE_CHANNEL_WITH_CONSUMPTION: channel=%', v_patch.channel
            USING ERRCODE = 'P0001';
        END IF;
        DELETE FROM voucher_program_channel_allocations
        WHERE program_id = p_program_id AND channel = v_patch.channel;
        v_changes := v_changes || jsonb_build_object('channel:' || v_patch.channel, 'removed');
      ELSE
        INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
        VALUES (p_program_id, v_patch.channel, v_patch.cap, COALESCE(v_patch.active, true))
        ON CONFLICT (program_id, channel) DO UPDATE
          SET cap    = EXCLUDED.cap,
              active = EXCLUDED.active;
        v_changes := v_changes || jsonb_build_object(
          'channel:' || v_patch.channel,
          jsonb_build_object('cap', v_patch.cap, 'active', COALESCE(v_patch.active, true))
        );
      END IF;
    END LOOP;
  END IF;

  IF v_changes <> '{}'::jsonb THEN
    INSERT INTO merchant_audit_log (merchant_user_id, partner_id, action, metadata)
    VALUES (
      p_merchant_user_id, p_partner_id, 'program.updated',
      jsonb_build_object('program_id', p_program_id, 'changes', v_changes)
    );
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION update_voucher_program(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,uuid,jsonb,boolean,boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_voucher_program(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,uuid,jsonb,boolean,boolean) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 12 — transition_program_state
-- ══════════════════════════════════════════════════════════════════════════════
-- Validates and applies a state transition.  Audit uses live production schema.

DROP FUNCTION IF EXISTS transition_program_state(uuid,text,text);

CREATE OR REPLACE FUNCTION transition_program_state(
  p_program_id        uuid,
  p_new_state         text,
  p_merchant_user_id  uuid,
  p_partner_id        uuid
)
RETURNS TABLE (ok boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program     record;
  v_cap_sum     bigint;
  v_alloc_count integer;
BEGIN
  SELECT id, state, total_cap, start_at, end_at INTO v_program
  FROM voucher_programs
  WHERE id = p_program_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_state NOT IN ('active','paused','ended') THEN
    RAISE EXCEPTION 'INVALID_STATE: %', p_new_state USING ERRCODE = 'P0001';
  END IF;

  IF v_program.state = 'draft'  AND p_new_state NOT IN ('active') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % → %', v_program.state, p_new_state USING ERRCODE = 'P0001';
  END IF;
  IF v_program.state = 'active' AND p_new_state NOT IN ('paused','ended') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % → %', v_program.state, p_new_state USING ERRCODE = 'P0001';
  END IF;
  IF v_program.state = 'paused' AND p_new_state NOT IN ('active','ended') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % → %', v_program.state, p_new_state USING ERRCODE = 'P0001';
  END IF;
  IF v_program.state = 'ended' THEN
    RAISE EXCEPTION 'PROGRAM_ALREADY_ENDED' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_state = 'active' THEN
    IF v_program.total_cap IS NULL OR v_program.total_cap <= 0 THEN
      RAISE EXCEPTION 'ACTIVATION_REQUIRES_TOTAL_CAP' USING ERRCODE = 'P0001';
    END IF;
    IF v_program.start_at IS NOT NULL AND v_program.end_at IS NOT NULL
       AND v_program.start_at >= v_program.end_at THEN
      RAISE EXCEPTION 'INVALID_SCHEDULE: start_at must be before end_at' USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_alloc_count
    FROM voucher_program_channel_allocations
    WHERE program_id = p_program_id AND active = true AND cap > 0;
    IF v_alloc_count = 0 THEN
      RAISE EXCEPTION 'ACTIVATION_REQUIRES_ACTIVE_CHANNEL' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM(cap), 0) INTO v_cap_sum
    FROM voucher_program_channel_allocations
    WHERE program_id = p_program_id AND active = true AND cap IS NOT NULL;
    IF v_cap_sum > v_program.total_cap THEN
      RAISE EXCEPTION 'CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP: sum=%, total=%',
        v_cap_sum, v_program.total_cap USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE voucher_programs SET state = p_new_state, updated_at = now() WHERE id = p_program_id;

  -- Only write to merchant_audit_log when called by a merchant actor.
  -- Admin callers pass NULL for p_merchant_user_id and write to admin_audit_logs separately.
  IF p_merchant_user_id IS NOT NULL THEN
    INSERT INTO merchant_audit_log (merchant_user_id, partner_id, action, metadata)
    VALUES (
      p_merchant_user_id,
      p_partner_id,
      'program.state_changed',
      jsonb_build_object(
        'program_id', p_program_id,
        'from_state', v_program.state,
        'to_state',   p_new_state
      )
    );
  END IF;

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION transition_program_state(uuid,text,uuid,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION transition_program_state(uuid,text,uuid,uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 13 — issue_voucher_from_program (hardened)
-- ══════════════════════════════════════════════════════════════════════════════
-- Callers cannot supply sponsor or funding_type — loaded from program under lock.
-- 8-parameter version; old 10-parameter overload is dropped.

DROP FUNCTION IF EXISTS issue_voucher_from_program(uuid,text,text,text,uuid,text,jsonb,text,text,text);

CREATE OR REPLACE FUNCTION issue_voucher_from_program(
  p_program_id        uuid,
  p_channel           text,
  p_source_ref        text,
  p_recipient_address text,
  p_hub_user_id       uuid,
  p_code              text,
  p_evidence          jsonb,
  p_actor_id          text
)
RETURNS TABLE (ok boolean, voucher_id uuid, code text, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program          record;
  v_alloc            record;
  v_existing         record;
  v_total_consumed   bigint;
  v_chan_consumed    bigint;
  v_voucher_id       uuid;
  v_snap             jsonb;
  v_resolved_address text;
  v_wallet           text;
BEGIN
  IF p_recipient_address IS NULL AND p_hub_user_id IS NULL THEN
    RAISE EXCEPTION 'RECIPIENT_REQUIRED: supply p_recipient_address or p_hub_user_id'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_recipient_address IS NULL THEN
    SELECT lower(address) INTO v_wallet
    FROM hub_user_wallets WHERE user_id = p_hub_user_id ORDER BY linked_at LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NO_LINKED_WALLET: hub_user_id=% has no linked wallet', p_hub_user_id
        USING ERRCODE = 'P0001';
    END IF;
    v_resolved_address := v_wallet;
  ELSE
    v_resolved_address := lower(p_recipient_address);
  END IF;

  SELECT
      vp.id, vp.name, vp.state, vp.total_cap, vp.start_at, vp.end_at,
      vp.funding_type, vp.sponsor, vp.template_id,
      svt.partner_id      AS template_partner_id,
      svt.active          AS template_active,
      svt.expires_at      AS template_expires_at,
      svt.voucher_type,   svt.discount_percent, svt.discount_cusd,
      svt.applicable_category, svt.linked_product_id,
      svt.retail_value_cusd, svt.miles_cost, svt.title
    INTO v_program
    FROM voucher_programs vp
    JOIN spend_voucher_templates svt ON svt.id = vp.template_id
   WHERE vp.id = p_program_id
   FOR UPDATE OF vp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_program.state <> 'active' THEN
    RAISE EXCEPTION 'PROGRAM_NOT_ACTIVE: state=%', v_program.state USING ERRCODE = 'P0001';
  END IF;
  IF v_program.start_at IS NOT NULL AND now() < v_program.start_at THEN
    RAISE EXCEPTION 'PROGRAM_NOT_STARTED' USING ERRCODE = 'P0001';
  END IF;
  IF v_program.end_at IS NOT NULL AND now() > v_program.end_at THEN
    RAISE EXCEPTION 'PROGRAM_ENDED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_program.template_active THEN
    RAISE EXCEPTION 'TEMPLATE_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF v_program.template_expires_at IS NOT NULL AND now() > v_program.template_expires_at THEN
    RAISE EXCEPTION 'TEMPLATE_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_alloc
    FROM voucher_program_channel_allocations
   WHERE program_id = p_program_id AND channel = p_channel
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF NOT v_alloc.active THEN RAISE EXCEPTION 'CHANNEL_INACTIVE' USING ERRCODE = 'P0001'; END IF;

  -- Recipient-safe idempotency
  IF p_source_ref IS NOT NULL THEN
    SELECT iv.id, iv.code, iv.hub_user_id, iv.user_address INTO v_existing
      FROM issued_vouchers iv
     WHERE iv.program_id        = p_program_id
       AND iv.acquisition_source = p_channel
       AND iv.source_ref        = p_source_ref
     LIMIT 1;

    IF FOUND THEN
      IF p_hub_user_id IS NOT NULL
         AND v_existing.hub_user_id IS DISTINCT FROM p_hub_user_id THEN
        RAISE EXCEPTION 'SOURCE_REF_CONFLICT: hub_user_id mismatch' USING ERRCODE = 'P0001';
      END IF;
      IF lower(v_existing.user_address) <> v_resolved_address THEN
        RAISE EXCEPTION 'SOURCE_REF_CONFLICT: recipient_address mismatch' USING ERRCODE = 'P0001';
      END IF;
      RETURN QUERY SELECT true, v_existing.id, v_existing.code, ''::text;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM issued_vouchers
       WHERE source_ref         = p_source_ref
         AND acquisition_source = p_channel
         AND (program_id IS DISTINCT FROM p_program_id)
    ) THEN
      RAISE EXCEPTION 'SOURCE_REF_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_total_consumed
    FROM issued_vouchers WHERE program_id = p_program_id AND status NOT IN ('void');
  IF v_program.total_cap IS NOT NULL AND v_total_consumed >= v_program.total_cap THEN
    RAISE EXCEPTION 'TOTAL_CAP_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_chan_consumed
    FROM issued_vouchers
   WHERE program_id = p_program_id AND acquisition_source = p_channel AND status NOT IN ('void');
  IF v_alloc.cap IS NOT NULL AND v_chan_consumed >= v_alloc.cap THEN
    RAISE EXCEPTION 'CHANNEL_CAP_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;

  v_snap := jsonb_build_object(
    'template_id',         v_program.template_id,
    'merchant_id',         v_program.template_partner_id,
    'voucher_type',        v_program.voucher_type,
    'discount_percent',    v_program.discount_percent,
    'discount_cusd',       v_program.discount_cusd,
    'applicable_category', v_program.applicable_category,
    'linked_product_id',   v_program.linked_product_id,
    'retail_value_cusd',   v_program.retail_value_cusd,
    'miles_cost',          v_program.miles_cost,
    'title',               v_program.title,
    'snapshotted_at',      now(),
    'program_id',          p_program_id,
    'program_name',        v_program.name,
    'evidence',            COALESCE(p_evidence, '{}'::jsonb)
  );

  INSERT INTO issued_vouchers (
    user_address, merchant_id, voucher_template_id, code, status,
    hub_user_id, acquisition_source, source_ref, program_id,
    funding_type, sponsor, expires_at, rules_snapshot
  ) VALUES (
    v_resolved_address, v_program.template_partner_id, v_program.template_id,
    p_code, 'issued', p_hub_user_id, p_channel, p_source_ref, p_program_id,
    v_program.funding_type, v_program.sponsor,
    v_program.template_expires_at, v_snap
  )
  RETURNING id INTO v_voucher_id;

  INSERT INTO voucher_events (issued_voucher_id, event_type, actor_id, metadata)
  VALUES (
    v_voucher_id, 'issued', p_actor_id,
    jsonb_build_object(
      'program_id', p_program_id, 'channel', p_channel,
      'source_ref', p_source_ref, 'recipient', COALESCE(p_hub_user_id::text, v_resolved_address)
    )
  );

  RETURN QUERY SELECT true, v_voucher_id, p_code, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION issue_voucher_from_program(uuid,text,text,text,uuid,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_voucher_from_program(uuid,text,text,text,uuid,text,jsonb,text) FROM anon;
REVOKE ALL ON FUNCTION issue_voucher_from_program(uuid,text,text,text,uuid,text,jsonb,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION issue_voucher_from_program(uuid,text,text,text,uuid,text,jsonb,text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 14 — reserve_with_program_atomic_hub
-- ══════════════════════════════════════════════════════════════════════════════
-- Resolves the eligible miles_purchase program from the DB (never from caller).
-- PROGRAM_REQUIRED if zero programs eligible.
-- PROGRAM_AMBIGUOUS if more than one.
-- Calls reserve_voucher_atomic_hub with the correct 9-parameter Phase 1 signature
-- (including NULL::jsonb for p_rules_snapshot).
-- Stamps program_id on the reserved voucher atomically.

DROP FUNCTION IF EXISTS reserve_with_program_atomic_hub(uuid,text,uuid,text,text,uuid,text,text,uuid);

CREATE OR REPLACE FUNCTION reserve_with_program_atomic_hub(
  p_template_id      uuid,
  p_user_address     text,
  p_merchant_id      uuid,
  p_code             text,
  p_idempotency_key  text,
  p_hub_user_id      uuid
)
RETURNS TABLE (voucher_id uuid, code text, status text, miles_cost integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count       integer;
  v_program_id  uuid;
  v_program     record;
  v_alloc       record;
  v_result      record;
  v_consumed    bigint;
BEGIN
  -- ── 1. Count eligible programs (non-locking, quick existence check) ───────
  -- NOTE: MIN(uuid) does not exist in PostgreSQL; count first, then fetch id.
  SELECT COUNT(DISTINCT vp.id)
  INTO v_count
  FROM voucher_programs vp
  JOIN voucher_program_channel_allocations vpca
    ON vpca.program_id = vp.id AND vpca.channel = 'miles_purchase' AND vpca.active = true
  JOIN spend_voucher_templates svt ON svt.id = vp.template_id
  WHERE vp.template_id = p_template_id
    AND vp.state       = 'active'
    AND svt.active     = true
    AND (svt.expires_at IS NULL OR svt.expires_at > now())
    AND (vp.start_at   IS NULL OR vp.start_at   <= now())
    AND (vp.end_at     IS NULL OR vp.end_at      >  now());

  IF v_count = 0 THEN
    RAISE EXCEPTION 'PROGRAM_REQUIRED: no eligible miles_purchase program for template=%', p_template_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'PROGRAM_AMBIGUOUS: % eligible programs for template=%', v_count, p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Exactly one program: fetch its id.
  SELECT vp.id
  INTO v_program_id
  FROM voucher_programs vp
  JOIN voucher_program_channel_allocations vpca
    ON vpca.program_id = vp.id AND vpca.channel = 'miles_purchase' AND vpca.active = true
  JOIN spend_voucher_templates svt ON svt.id = vp.template_id
  WHERE vp.template_id = p_template_id
    AND vp.state       = 'active'
    AND svt.active     = true
    AND (svt.expires_at IS NULL OR svt.expires_at > now())
    AND (vp.start_at   IS NULL OR vp.start_at   <= now())
    AND (vp.end_at     IS NULL OR vp.end_at      >  now())
  LIMIT 1;

  -- ── 2. Acquire advisory lock before any row lock to avoid deadlocks ───────
  PERFORM pg_advisory_xact_lock(hashtext(v_program_id::text));

  -- ── 3. Lock and re-read the program ──────────────────────────────────────
  SELECT vp.id, vp.state, vp.total_cap, vp.start_at, vp.end_at, vp.template_id
  INTO v_program
  FROM voucher_programs vp
  WHERE vp.id = v_program_id
  FOR UPDATE;

  -- Re-validate after lock (state could have changed)
  IF v_program.state <> 'active' THEN
    RAISE EXCEPTION 'PROGRAM_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF v_program.start_at IS NOT NULL AND now() < v_program.start_at THEN
    RAISE EXCEPTION 'PROGRAM_NOT_STARTED' USING ERRCODE = 'P0001';
  END IF;
  IF v_program.end_at IS NOT NULL AND now() > v_program.end_at THEN
    RAISE EXCEPTION 'PROGRAM_ENDED' USING ERRCODE = 'P0001';
  END IF;
  IF v_program.template_id <> p_template_id THEN
    RAISE EXCEPTION 'PROGRAM_TEMPLATE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ── 4. Lock miles_purchase channel allocation ─────────────────────────────
  SELECT id, cap, active INTO v_alloc
  FROM voucher_program_channel_allocations
  WHERE program_id = v_program_id AND channel = 'miles_purchase'
  FOR UPDATE;

  IF NOT FOUND OR NOT v_alloc.active THEN
    RAISE EXCEPTION 'PROGRAM_CHANNEL_NOT_ACTIVE: miles_purchase' USING ERRCODE = 'P0001';
  END IF;

  -- ── 5. Cap check BEFORE reservation ──────────────────────────────────────
  IF v_program.total_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_consumed
    FROM issued_vouchers iv
    WHERE iv.program_id = v_program_id
      AND iv.status NOT IN ('void');
    IF v_consumed >= v_program.total_cap THEN
      RAISE EXCEPTION 'PROGRAM_TOTAL_CAP_EXCEEDED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_alloc.cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_consumed
    FROM issued_vouchers iv
    WHERE iv.program_id = v_program_id
      AND iv.acquisition_source = 'miles_purchase'
      AND iv.status NOT IN ('void');
    IF v_consumed >= v_alloc.cap THEN
      RAISE EXCEPTION 'PROGRAM_CHANNEL_CAP_EXCEEDED: miles_purchase' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 6. Reserve via Phase 1 RPC (correct 9-param signature) ───────────────
  SELECT r.voucher_id, r.code, r.status, r.miles_cost INTO v_result
  FROM reserve_voucher_atomic_hub(
    p_template_id,
    p_user_address,
    p_merchant_id,
    p_code,
    p_idempotency_key,
    p_hub_user_id,
    NULL::jsonb,          -- p_rules_snapshot (Phase 1 param, built from template at reservation)
    'miles_purchase',     -- p_acquisition_source
    'miles'               -- p_funding_type
  ) r;

  -- ── 7. Stamp program_id on the newly reserved voucher ────────────────────
  UPDATE issued_vouchers SET program_id = v_program_id WHERE id = v_result.voucher_id;

  RETURN QUERY SELECT v_result.voucher_id, v_result.code, v_result.status, v_result.miles_cost;
END;
$$;

REVOKE ALL ON FUNCTION reserve_with_program_atomic_hub(uuid,text,uuid,text,text,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION reserve_with_program_atomic_hub(uuid,text,uuid,text,text,uuid) TO service_role;
