-- 006_voucher_payout_execution_phase5.sql
-- Phase 5: voucher payout execution, provider abstraction, dual approval,
--          reconciliation and replay protection.
-- 001-005 are deployed and immutable. This migration is idempotent
-- (CREATE OR REPLACE / IF NOT EXISTS) and uses helpers defined in 005.
--
-- LIVE PAYOUT EXECUTION IS BLOCKED: no M-Pesa B2C credentials, no Celo signing
-- key. The schema + RPCs here support a provider abstraction; the application
-- layer only enables the 'test' and 'manual' providers until credentials exist.

-- ============================================================================
-- SECTION 1 -- Extend merchant_settlement_batches state machine
-- ============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'merchant_settlement_batches'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%state%'
  LOOP
    EXECUTE format('ALTER TABLE merchant_settlement_batches DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE merchant_settlement_batches
  ADD CONSTRAINT chk_msb_state CHECK (state IN (
    'draft','approved','processing','submitted','confirmed','paid','cancelled','failed','uncertain'
  ));

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'merchant_settlement_batch_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE merchant_settlement_batch_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE merchant_settlement_batch_events
  ADD CONSTRAINT chk_msbe_event_type CHECK (event_type IN (
    'created','approved','processing','submitted','confirmed','paid','cancelled','failed','uncertain'
  ));

ALTER TABLE merchant_settlement_batches ADD COLUMN IF NOT EXISTS submitted_at          timestamptz;
ALTER TABLE merchant_settlement_batches ADD COLUMN IF NOT EXISTS confirmed_at          timestamptz;
ALTER TABLE merchant_settlement_batches ADD COLUMN IF NOT EXISTS payout_instruction_id uuid;

-- ============================================================================
-- SECTION 2 -- merchant_payout_destinations (versioned, encrypted)
-- ============================================================================

CREATE TABLE IF NOT EXISTS merchant_payout_destinations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id           uuid        NOT NULL,
  version              integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  previous_version_id  uuid        REFERENCES merchant_payout_destinations(id) ON DELETE SET NULL,
  destination_type     text        NOT NULL CHECK (destination_type IN ('mpesa','bank','celo_wallet','manual')),
  display_name         text        NOT NULL CHECK (trim(display_name) <> ''),
  currency             text        NOT NULL CHECK (currency IN ('KES','USD','cUSD')),
  encrypted_destination jsonb      NOT NULL,
  destination_summary  text        NOT NULL,
  verified_at          timestamptz,
  verified_by          text,
  approved_at          timestamptz,
  approved_by          text,
  is_active            boolean     NOT NULL DEFAULT false,
  last_modified_at     timestamptz NOT NULL DEFAULT now(),
  created_by           text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpd_partner ON merchant_payout_destinations(partner_id, is_active);

ALTER TABLE merchant_payout_destinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpd_deny_anon ON merchant_payout_destinations;
CREATE POLICY mpd_deny_anon ON merchant_payout_destinations FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS mpd_deny_auth ON merchant_payout_destinations;
CREATE POLICY mpd_deny_auth ON merchant_payout_destinations FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- SECTION 3 -- payout provider configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS payout_provider_config (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name           text          NOT NULL UNIQUE CHECK (provider_name IN ('mpesa_b2c','celo','manual','test')),
  is_enabled              boolean       NOT NULL DEFAULT false,
  is_paused               boolean       NOT NULL DEFAULT false,
  pause_reason            text,
  paused_at               timestamptz,
  paused_by               text,
  per_payout_limit        numeric(20,6) NOT NULL DEFAULT 100000,
  daily_limit             numeric(20,6) NOT NULL DEFAULT 1000000,
  dual_approval_threshold numeric(20,6) NOT NULL DEFAULT 50000,
  supported_currencies    text[]        NOT NULL DEFAULT ARRAY['USD'],
  metadata                jsonb,
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  updated_by              text
);

INSERT INTO payout_provider_config (provider_name, is_enabled, is_paused, per_payout_limit, daily_limit, dual_approval_threshold, supported_currencies)
VALUES
  ('test',     true,  false, 999999, 99999999, 50000, ARRAY['USD','KES','cUSD']),
  ('mpesa_b2c',false, false, 150000, 2000000,  50000, ARRAY['KES']),
  ('celo',     false, false, 100000, 500000,   50000, ARRAY['cUSD']),
  ('manual',   true,  false, 999999, 99999999, 0,     ARRAY['USD','KES','cUSD'])
ON CONFLICT (provider_name) DO NOTHING;

ALTER TABLE payout_provider_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppc_deny_anon ON payout_provider_config;
CREATE POLICY ppc_deny_anon ON payout_provider_config FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ppc_deny_auth ON payout_provider_config;
CREATE POLICY ppc_deny_auth ON payout_provider_config FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- SECTION 4 -- settlement_payout_instructions (one per batch)
-- ============================================================================

CREATE TABLE IF NOT EXISTS settlement_payout_instructions (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             uuid          NOT NULL UNIQUE REFERENCES merchant_settlement_batches(id) ON DELETE RESTRICT,
  destination_id       uuid          NOT NULL REFERENCES merchant_payout_destinations(id) ON DELETE RESTRICT,
  destination_snapshot jsonb         NOT NULL,
  provider_name        text          NOT NULL,
  amount               numeric(20,6) NOT NULL CHECK (amount > 0),
  currency             text          NOT NULL,
  idempotency_key      text          NOT NULL UNIQUE,
  state                text          NOT NULL DEFAULT 'pending'
                       CHECK (state IN ('pending','submitted','confirmed','failed','uncertain','cancelled')),
  initiated_by         text          NOT NULL,
  secondary_approver   text,
  submitted_at         timestamptz,
  confirmed_at         timestamptz,
  failed_at            timestamptz,
  uncertain_at         timestamptz,
  provider_reference   text,
  failure_reason       text,
  failure_code         text,
  polling_deadline     timestamptz,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spi_state ON settlement_payout_instructions(state, created_at);
CREATE INDEX IF NOT EXISTS idx_spi_provider_ref ON settlement_payout_instructions(provider_reference) WHERE provider_reference IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_msb_payout_instruction'
      AND conrelid = 'merchant_settlement_batches'::regclass
  ) THEN
    ALTER TABLE merchant_settlement_batches
      ADD CONSTRAINT fk_msb_payout_instruction
      FOREIGN KEY (payout_instruction_id)
      REFERENCES settlement_payout_instructions(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE settlement_payout_instructions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spi_deny_anon ON settlement_payout_instructions;
CREATE POLICY spi_deny_anon ON settlement_payout_instructions FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS spi_deny_auth ON settlement_payout_instructions;
CREATE POLICY spi_deny_auth ON settlement_payout_instructions FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- SECTION 5 -- settlement_payout_attempts (append-only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS settlement_payout_attempts (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_id        uuid          NOT NULL REFERENCES settlement_payout_instructions(id) ON DELETE RESTRICT,
  attempt_number        integer       NOT NULL DEFAULT 1,
  provider_name         text          NOT NULL,
  provider_request_hash text,
  provider_reference    text,
  raw_response_hash     text,
  status                text          NOT NULL CHECK (status IN ('initiated','submitted','confirmed','failed','uncertain','timeout')),
  failure_code          text,
  failure_reason        text,
  amount                numeric(20,6) NOT NULL,
  currency              text          NOT NULL,
  actor_id              text          NOT NULL,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spa_instruction ON settlement_payout_attempts(instruction_id);

DROP TRIGGER IF EXISTS trg_spa_no_mutation ON settlement_payout_attempts;
CREATE TRIGGER trg_spa_no_mutation
  BEFORE UPDATE OR DELETE ON settlement_payout_attempts
  FOR EACH ROW EXECUTE FUNCTION fn_financial_row_no_mutation();

ALTER TABLE settlement_payout_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_deny_anon ON settlement_payout_attempts;
CREATE POLICY spa_deny_anon ON settlement_payout_attempts FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS spa_deny_auth ON settlement_payout_attempts;
CREATE POLICY spa_deny_auth ON settlement_payout_attempts FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- SECTION 6 -- settlement_provider_callbacks (replay protection)
-- ============================================================================

CREATE TABLE IF NOT EXISTS settlement_provider_callbacks (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name         text          NOT NULL,
  provider_reference    text,
  raw_body_hash         text          NOT NULL,
  signature_verified    boolean       NOT NULL DEFAULT false,
  processed             boolean       NOT NULL DEFAULT false,
  processing_result     text,
  amount_received       numeric(20,6),
  currency_received     text,
  instruction_id        uuid          REFERENCES settlement_payout_instructions(id),
  incident_id           uuid,
  received_at           timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_spc_body_hash ON settlement_provider_callbacks(raw_body_hash);
CREATE INDEX IF NOT EXISTS idx_spc_provider_ref ON settlement_provider_callbacks(provider_reference);

ALTER TABLE settlement_provider_callbacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spc_deny_anon ON settlement_provider_callbacks;
CREATE POLICY spc_deny_anon ON settlement_provider_callbacks FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS spc_deny_auth ON settlement_provider_callbacks;
CREATE POLICY spc_deny_auth ON settlement_provider_callbacks FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- SECTION 7 -- settlement_payout_events (append-only audit log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS settlement_payout_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_id  uuid        NOT NULL REFERENCES settlement_payout_instructions(id) ON DELETE RESTRICT,
  event_type      text        NOT NULL CHECK (event_type IN (
    'instruction_created','destination_set','secondary_approved','submitted','confirmed','failed',
    'uncertain','retry_initiated','manual_confirmed','cancelled','callback_received','incident_created'
  )),
  actor_id        text        NOT NULL,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spe_instruction ON settlement_payout_events(instruction_id, created_at);

DROP TRIGGER IF EXISTS trg_spe_no_mutation ON settlement_payout_events;
CREATE TRIGGER trg_spe_no_mutation
  BEFORE UPDATE OR DELETE ON settlement_payout_events
  FOR EACH ROW EXECUTE FUNCTION fn_financial_row_no_mutation();

ALTER TABLE settlement_payout_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spe_deny_anon ON settlement_payout_events;
CREATE POLICY spe_deny_anon ON settlement_payout_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS spe_deny_auth ON settlement_payout_events;
CREATE POLICY spe_deny_auth ON settlement_payout_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- SECTION 8 -- RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION create_payout_instruction(
  p_batch_id uuid,
  p_destination_id uuid,
  p_actor text
) RETURNS TABLE(ok boolean, instruction_id uuid, requires_secondary_approval boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch       record;
  v_dest        record;
  v_cfg         record;
  v_daily_total numeric;
  v_id          uuid;
  v_requires    boolean := false;
  v_snapshot    jsonb;
BEGIN
  -- Prevent concurrent duplicate instruction creation for the same batch.
  PERFORM pg_advisory_xact_lock(hashtext(p_batch_id::text));

  SELECT * INTO v_batch FROM merchant_settlement_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_batch.state <> 'approved' THEN RAISE EXCEPTION 'BATCH_NOT_APPROVED' USING ERRCODE = 'P0001'; END IF;

  IF EXISTS (
    SELECT 1 FROM settlement_payout_instructions
    WHERE batch_id = p_batch_id AND state IN ('pending','submitted','confirmed','uncertain')
  ) THEN
    RAISE EXCEPTION 'INSTRUCTION_ALREADY_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_dest FROM merchant_payout_destinations WHERE id = p_destination_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESTINATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_dest.partner_id IS DISTINCT FROM v_batch.partner_id THEN
    RAISE EXCEPTION 'DESTINATION_WRONG_PARTNER' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_dest.is_active OR v_dest.approved_at IS NULL THEN
    RAISE EXCEPTION 'DESTINATION_NOT_APPROVED' USING ERRCODE = 'P0001';
  END IF;
  IF v_dest.last_modified_at >= now() - interval '24 hours' THEN
    RAISE EXCEPTION 'DESTINATION_COOLING_PERIOD' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cfg FROM payout_provider_config
  WHERE provider_name = CASE v_dest.destination_type
    WHEN 'mpesa'       THEN 'mpesa_b2c'
    WHEN 'celo_wallet' THEN 'celo'
    WHEN 'bank'        THEN 'manual'
    ELSE 'manual'
  END;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_CONFIGURED' USING ERRCODE = 'P0001'; END IF;
  IF NOT v_cfg.is_enabled THEN RAISE EXCEPTION 'PROVIDER_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF v_cfg.is_paused THEN RAISE EXCEPTION 'PROVIDER_PAUSED' USING ERRCODE = 'P0001'; END IF;

  IF v_batch.total_payable_amount > v_cfg.per_payout_limit THEN
    RAISE EXCEPTION 'EXCEEDS_PER_PAYOUT_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(amount),0) INTO v_daily_total
  FROM settlement_payout_instructions
  WHERE provider_name = v_cfg.provider_name
    AND state IN ('submitted','confirmed','uncertain')
    AND submitted_at >= date_trunc('day', now());
  IF v_daily_total + v_batch.total_payable_amount > v_cfg.daily_limit THEN
    RAISE EXCEPTION 'DAILY_LIMIT_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;

  IF v_batch.total_payable_amount >= v_cfg.dual_approval_threshold AND v_cfg.dual_approval_threshold > 0 THEN
    v_requires := true;
  END IF;

  v_snapshot := jsonb_build_object(
    'display_name', v_dest.display_name,
    'destination_type', v_dest.destination_type,
    'currency', v_dest.currency,
    'destination_summary', v_dest.destination_summary,
    'version', v_dest.version
  );

  INSERT INTO settlement_payout_instructions(
    batch_id, destination_id, destination_snapshot, provider_name, amount, currency,
    idempotency_key, state, initiated_by
  ) VALUES (
    p_batch_id, p_destination_id, v_snapshot, v_cfg.provider_name,
    v_batch.total_payable_amount, v_batch.currency,
    'payout:'||p_batch_id::text, 'pending', p_actor
  ) RETURNING id INTO v_id;

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (v_id, 'instruction_created', p_actor,
    jsonb_build_object('batch_id', p_batch_id, 'requires_secondary_approval', v_requires));

  UPDATE merchant_settlement_batches
  SET state='processing', payout_instruction_id=v_id, updated_at=now(), updated_by=p_actor
  WHERE id = p_batch_id;

  RETURN QUERY SELECT true, v_id, v_requires, ''::text;
END;
$$;

CREATE OR REPLACE FUNCTION provide_secondary_approval(
  p_instruction_id uuid,
  p_actor text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v.state <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = 'P0001'; END IF;
  IF p_actor = v.initiated_by THEN RAISE EXCEPTION 'CANNOT_SELF_APPROVE' USING ERRCODE = 'P0001'; END IF;
  IF v.secondary_approver IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_APPROVED' USING ERRCODE = 'P0001'; END IF;

  UPDATE settlement_payout_instructions
  SET secondary_approver = p_actor, updated_at = now()
  WHERE id = p_instruction_id;

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'secondary_approved', p_actor, '{}'::jsonb);

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION record_payout_submission(
  p_instruction_id uuid,
  p_actor text,
  p_provider_reference text,
  p_request_hash text,
  p_response_hash text,
  p_polling_deadline timestamptz
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; v_attempt integer;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v.state = 'submitted' AND v.provider_reference IS NOT DISTINCT FROM p_provider_reference THEN
    RETURN QUERY SELECT true; RETURN;
  END IF;
  IF v.state <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(max(attempt_number),0)+1 INTO v_attempt
  FROM settlement_payout_attempts WHERE instruction_id = p_instruction_id;

  UPDATE settlement_payout_instructions
  SET state='submitted', provider_reference=p_provider_reference, submitted_at=now(),
      polling_deadline=p_polling_deadline, updated_at=now()
  WHERE id = p_instruction_id;

  UPDATE merchant_settlement_batches
  SET state='submitted', submitted_at=now(), updated_at=now(), updated_by=p_actor
  WHERE id = v.batch_id;

  INSERT INTO settlement_payout_attempts(
    instruction_id, attempt_number, provider_name, provider_request_hash, provider_reference,
    raw_response_hash, status, amount, currency, actor_id
  ) VALUES (
    p_instruction_id, v_attempt, v.provider_name, p_request_hash, p_provider_reference,
    p_response_hash, 'submitted', v.amount, v.currency, p_actor
  );

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'submitted', p_actor,
    jsonb_build_object('provider_reference', p_provider_reference));

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION record_payout_confirmation(
  p_instruction_id uuid,
  p_actor text,
  p_provider_reference text,
  p_confirmed_amount numeric,
  p_confirmed_currency text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; v_attempt integer; v_incident uuid;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v.state = 'confirmed' THEN RETURN QUERY SELECT true; RETURN; END IF;
  IF v.state NOT IN ('submitted','uncertain') THEN RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = 'P0001'; END IF;

  IF p_confirmed_amount IS NOT NULL AND abs(p_confirmed_amount - v.amount) > 0.01 THEN
    INSERT INTO reconciliation_incidents(type, data)
    VALUES ('payout_amount_mismatch', jsonb_build_object(
      'instruction_id', p_instruction_id, 'expected', v.amount, 'confirmed', p_confirmed_amount))
    RETURNING id INTO v_incident;
    INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
    VALUES (p_instruction_id, 'incident_created', p_actor,
      jsonb_build_object('incident_id', v_incident, 'reason', 'amount_mismatch'));
    RAISE EXCEPTION 'AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF p_confirmed_currency IS NOT NULL AND p_confirmed_currency <> v.currency THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(attempt_number),0)+1 INTO v_attempt
  FROM settlement_payout_attempts WHERE instruction_id = p_instruction_id;

  UPDATE settlement_payout_instructions
  SET state='confirmed', confirmed_at=now(),
      provider_reference=COALESCE(p_provider_reference, provider_reference), updated_at=now()
  WHERE id = p_instruction_id;

  UPDATE merchant_settlement_batches
  SET state='paid', paid_at=now(), confirmed_at=now(), updated_at=now(), updated_by=p_actor
  WHERE id = v.batch_id;

  INSERT INTO settlement_payout_attempts(
    instruction_id, attempt_number, provider_name, provider_reference, status, amount, currency, actor_id
  ) VALUES (
    p_instruction_id, v_attempt, v.provider_name, COALESCE(p_provider_reference, v.provider_reference),
    'confirmed', v.amount, v.currency, p_actor
  );

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'confirmed', p_actor,
    jsonb_build_object('confirmed_amount', p_confirmed_amount, 'currency', p_confirmed_currency));

  INSERT INTO merchant_settlement_batch_events(batch_id, event_type, actor_id, metadata)
  VALUES (v.batch_id, 'paid', p_actor, jsonb_build_object('instruction_id', p_instruction_id));

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION record_payout_failure(
  p_instruction_id uuid,
  p_actor text,
  p_failure_code text,
  p_failure_reason text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; v_attempt integer;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v.state NOT IN ('submitted','uncertain','pending') THEN RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(max(attempt_number),0)+1 INTO v_attempt
  FROM settlement_payout_attempts WHERE instruction_id = p_instruction_id;

  UPDATE settlement_payout_instructions
  SET state='failed', failed_at=now(), failure_code=p_failure_code, failure_reason=p_failure_reason, updated_at=now()
  WHERE id = p_instruction_id;

  UPDATE merchant_settlement_batches
  SET state='failed', failure_reason=p_failure_reason, failed_at=now(), updated_at=now(), updated_by=p_actor
  WHERE id = v.batch_id;

  INSERT INTO settlement_payout_attempts(
    instruction_id, attempt_number, provider_name, provider_reference, status,
    failure_code, failure_reason, amount, currency, actor_id
  ) VALUES (
    p_instruction_id, v_attempt, v.provider_name, v.provider_reference, 'failed',
    p_failure_code, p_failure_reason, v.amount, v.currency, p_actor
  );

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'failed', p_actor,
    jsonb_build_object('failure_code', p_failure_code, 'failure_reason', p_failure_reason));

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION mark_payout_uncertain(
  p_instruction_id uuid,
  p_actor text,
  p_reason text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; v_incident uuid;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v.state <> 'submitted' THEN RAISE EXCEPTION 'NOT_SUBMITTED' USING ERRCODE = 'P0001'; END IF;

  UPDATE settlement_payout_instructions
  SET state='uncertain', uncertain_at=now(), updated_at=now()
  WHERE id = p_instruction_id;

  UPDATE merchant_settlement_batches
  SET state='uncertain', updated_at=now(), updated_by=p_actor
  WHERE id = v.batch_id;

  INSERT INTO reconciliation_incidents(type, data)
  VALUES ('payout_uncertain', jsonb_build_object('instruction_id', p_instruction_id, 'reason', p_reason))
  RETURNING id INTO v_incident;

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'uncertain', p_actor,
    jsonb_build_object('reason', p_reason, 'incident_id', v_incident));

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION retry_payout(
  p_instruction_id uuid,
  p_actor text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v.state NOT IN ('failed','uncertain') THEN RAISE EXCEPTION 'CANNOT_RETRY_IN_STATE' USING ERRCODE = 'P0001'; END IF;

  UPDATE settlement_payout_instructions
  SET state='pending', failure_code=NULL, failure_reason=NULL,
      failed_at=NULL, uncertain_at=NULL, provider_reference=NULL,
      submitted_at=NULL, polling_deadline=NULL, updated_at=now()
  WHERE id = p_instruction_id;

  UPDATE merchant_settlement_batches
  SET state='approved', updated_at=now(), updated_by=p_actor
  WHERE id = v.batch_id;

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'retry_initiated', p_actor, '{}'::jsonb);

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION process_provider_callback(
  p_provider_name text,
  p_raw_body_hash text,
  p_provider_reference text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_signature_verified boolean,
  p_actor text
) RETURNS TABLE(ok boolean, already_processed boolean, instruction_id uuid, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_callback uuid;
  v_inst     record;
  v_incident uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM settlement_provider_callbacks WHERE raw_body_hash = p_raw_body_hash) THEN
    RETURN QUERY SELECT true, true, NULL::uuid, ''::text; RETURN;
  END IF;

  INSERT INTO settlement_provider_callbacks(
    provider_name, provider_reference, raw_body_hash, signature_verified,
    amount_received, currency_received
  ) VALUES (
    p_provider_name, p_provider_reference, p_raw_body_hash, p_signature_verified,
    p_amount, p_currency
  ) RETURNING id INTO v_callback;

  IF NOT p_signature_verified THEN
    INSERT INTO reconciliation_incidents(type, data)
    VALUES ('payout_callback_invalid_signature',
      jsonb_build_object('provider', p_provider_name, 'provider_reference', p_provider_reference))
    RETURNING id INTO v_incident;
    UPDATE settlement_provider_callbacks
    SET processed=false, processing_result='invalid_signature', incident_id=v_incident
    WHERE id = v_callback;
    RETURN QUERY SELECT false, false, NULL::uuid, 'INVALID_SIGNATURE'::text; RETURN;
  END IF;

  SELECT * INTO v_inst FROM settlement_payout_instructions
  WHERE provider_reference = p_provider_reference FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO reconciliation_incidents(type, data)
    VALUES ('payout_callback_unknown_reference',
      jsonb_build_object('provider', p_provider_name, 'provider_reference', p_provider_reference))
    RETURNING id INTO v_incident;
    UPDATE settlement_provider_callbacks
    SET processed=false, processing_result='unknown_reference', incident_id=v_incident
    WHERE id = v_callback;
    RETURN QUERY SELECT false, false, NULL::uuid, 'UNKNOWN_REFERENCE'::text; RETURN;
  END IF;

  IF p_status = 'confirmed' THEN
    PERFORM record_payout_confirmation(v_inst.id, p_actor, p_provider_reference, p_amount, p_currency);
  ELSIF p_status = 'failed' THEN
    PERFORM record_payout_failure(v_inst.id, p_actor, 'provider_callback', 'failed via provider callback');
  ELSE
    UPDATE settlement_provider_callbacks
    SET processed=true, processing_result='ignored_status:'||p_status, instruction_id=v_inst.id
    WHERE id = v_callback;
    RETURN QUERY SELECT true, false, v_inst.id, ''::text; RETURN;
  END IF;

  UPDATE settlement_provider_callbacks
  SET processed=true, processing_result='processed:'||p_status, instruction_id=v_inst.id
  WHERE id = v_callback;

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (v_inst.id, 'callback_received', p_actor, jsonb_build_object('status', p_status));

  RETURN QUERY SELECT true, false, v_inst.id, ''::text;
END;
$$;

CREATE OR REPLACE FUNCTION pause_payout_provider(
  p_provider_name text, p_reason text, p_actor text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE payout_provider_config
  SET is_paused=true, pause_reason=p_reason, paused_at=now(), paused_by=p_actor,
      updated_at=now(), updated_by=p_actor
  WHERE provider_name = p_provider_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION resume_payout_provider(
  p_provider_name text, p_actor text
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE payout_provider_config
  SET is_paused=false, pause_reason=NULL, paused_at=NULL, paused_by=NULL,
      updated_at=now(), updated_by=p_actor
  WHERE provider_name = p_provider_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION register_payout_destination(
  p_partner_id uuid,
  p_destination_type text,
  p_display_name text,
  p_currency text,
  p_encrypted_destination jsonb,
  p_destination_summary text,
  p_merchant_user_id uuid,
  p_created_by text,
  p_previous_version_id uuid DEFAULT NULL
) RETURNS TABLE(ok boolean, destination_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev record; v_version integer := 1; v_id uuid;
BEGIN
  IF p_previous_version_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM merchant_payout_destinations WHERE id = p_previous_version_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PREVIOUS_VERSION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
    IF v_prev.partner_id IS DISTINCT FROM p_partner_id THEN
      RAISE EXCEPTION 'PREVIOUS_VERSION_WRONG_PARTNER' USING ERRCODE = 'P0001';
    END IF;
    IF v_prev.destination_type <> p_destination_type THEN
      RAISE EXCEPTION 'PREVIOUS_VERSION_TYPE_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    v_version := v_prev.version + 1;
  END IF;

  INSERT INTO merchant_payout_destinations(
    partner_id, version, previous_version_id, destination_type, display_name, currency,
    encrypted_destination, destination_summary, is_active, last_modified_at, created_by
  ) VALUES (
    p_partner_id, v_version, p_previous_version_id, p_destination_type, p_display_name, p_currency,
    p_encrypted_destination, p_destination_summary, false, now(), p_created_by
  ) RETURNING id INTO v_id;

  IF p_previous_version_id IS NOT NULL THEN
    UPDATE merchant_payout_destinations
    SET is_active=false, last_modified_at=now()
    WHERE id = p_previous_version_id;
  END IF;

  INSERT INTO merchant_audit_log(merchant_user_id, partner_id, action, metadata)
  VALUES (p_merchant_user_id, p_partner_id, 'payout_destination.registered',
    jsonb_build_object('destination_id', v_id, 'destination_type', p_destination_type,
      'currency', p_currency, 'summary', p_destination_summary));

  RETURN QUERY SELECT true, v_id;
END;
$$;

CREATE OR REPLACE FUNCTION approve_payout_destination(
  p_destination_id uuid,
  p_actor text,
  p_actor_type text DEFAULT 'admin'
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM merchant_payout_destinations WHERE id = p_destination_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESTINATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  UPDATE merchant_payout_destinations
  SET approved_at=now(), approved_by=p_actor, is_active=true, last_modified_at=now()
  WHERE id = p_destination_id;

  -- Approval is an admin action audited via writeAdminAuditLog in the API route.
  -- merchant_audit_log.merchant_user_id is NOT NULL, so we do not write there here.

  RETURN QUERY SELECT true;
END;
$$;

-- ============================================================================
-- SECTION 9 -- Reporting views
-- ============================================================================

CREATE OR REPLACE VIEW v_payout_instruction_summary AS
SELECT
  i.id                        AS instruction_id,
  i.batch_id,
  i.state                     AS instruction_state,
  b.state                     AS batch_state,
  b.partner_id,
  i.provider_name,
  i.amount,
  i.currency,
  i.provider_reference,
  i.secondary_approver,
  i.initiated_by,
  i.polling_deadline,
  i.submitted_at,
  i.confirmed_at,
  i.failed_at,
  i.uncertain_at,
  i.failure_code,
  i.failure_reason,
  i.destination_snapshot->>'display_name' AS destination_display_name,
  i.destination_snapshot->>'destination_summary' AS destination_summary,
  i.created_at,
  i.updated_at
FROM settlement_payout_instructions i
JOIN merchant_settlement_batches b ON b.id = i.batch_id;

CREATE OR REPLACE VIEW v_provider_daily_totals AS
SELECT
  provider_name,
  count(*)::integer        AS instruction_count,
  COALESCE(sum(amount),0)  AS total_amount,
  currency
FROM settlement_payout_instructions
WHERE state IN ('submitted','confirmed','uncertain')
  AND submitted_at >= date_trunc('day', now())
GROUP BY provider_name, currency;

CREATE OR REPLACE VIEW v_pending_payout_queue AS
SELECT
  b.id            AS batch_id,
  b.partner_id,
  b.currency,
  b.item_count,
  b.total_payable_amount,
  b.approved_at,
  b.created_at
FROM merchant_settlement_batches b
WHERE b.state = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM settlement_payout_instructions i
    WHERE i.batch_id = b.id AND i.state <> 'cancelled'
  );

CREATE OR REPLACE VIEW v_uncertain_payouts AS
SELECT
  i.id                AS instruction_id,
  i.batch_id,
  i.provider_name,
  i.amount,
  i.currency,
  i.state,
  i.provider_reference,
  i.polling_deadline,
  i.submitted_at,
  i.uncertain_at,
  i.created_at
FROM settlement_payout_instructions i
WHERE i.state IN ('uncertain','submitted')
  AND i.polling_deadline IS NOT NULL
  AND i.polling_deadline < now();

-- ============================================================================
-- SECTION 10 -- Backfill / consistency check (non-destructive)
-- ============================================================================
-- Flag any batch left in a payout state without a backing instruction as an
-- operational incident so reconciliation can recover it. Idempotent.

DO $$
DECLARE r record; v_count integer := 0;
BEGIN
  FOR r IN
    SELECT b.id
    FROM merchant_settlement_batches b
    WHERE b.state IN ('processing','submitted','uncertain')
      AND NOT EXISTS (
        SELECT 1 FROM settlement_payout_instructions i
        WHERE i.batch_id = b.id AND i.state <> 'cancelled'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM reconciliation_incidents
      WHERE type = 'payout_batch_without_instruction'
        AND data->>'batch_id' = r.id::text
    ) THEN
      INSERT INTO reconciliation_incidents(type, data)
      VALUES ('payout_batch_without_instruction', jsonb_build_object('batch_id', r.id));
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Phase 5 backfill check: % orphaned payout batch(es) flagged', v_count;
END $$;

-- ============================================================================
-- SECTION 11 -- Privileges (service_role only)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON merchant_payout_destinations    TO service_role;
GRANT SELECT, INSERT, UPDATE ON payout_provider_config          TO service_role;
GRANT SELECT, INSERT, UPDATE ON settlement_payout_instructions  TO service_role;
GRANT SELECT, INSERT          ON settlement_payout_attempts      TO service_role;
GRANT SELECT, INSERT          ON settlement_payout_events        TO service_role;
GRANT SELECT, INSERT, UPDATE ON settlement_provider_callbacks   TO service_role;

GRANT SELECT ON v_payout_instruction_summary, v_provider_daily_totals,
  v_pending_payout_queue, v_uncertain_payouts TO service_role;

REVOKE ALL ON FUNCTION create_payout_instruction(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION provide_secondary_approval(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payout_submission(uuid,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payout_confirmation(uuid,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payout_failure(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_payout_uncertain(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION retry_payout(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION process_provider_callback(text,text,text,numeric,text,text,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pause_payout_provider(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resume_payout_provider(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION register_payout_destination(uuid,text,text,text,jsonb,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION approve_payout_destination(uuid,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_payout_instruction(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION provide_secondary_approval(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION record_payout_submission(uuid,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION record_payout_confirmation(uuid,text,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION record_payout_failure(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_payout_uncertain(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION retry_payout(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION process_provider_callback(text,text,text,numeric,text,text,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION pause_payout_provider(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION resume_payout_provider(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION register_payout_destination(uuid,text,text,text,jsonb,text,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION approve_payout_destination(uuid,text,text) TO service_role;
