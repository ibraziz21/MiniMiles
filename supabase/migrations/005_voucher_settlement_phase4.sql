-- 005_voucher_settlement_phase4.sql
-- Phase 4: voucher settlement, merchant reimbursement and reconciliation.
-- 001-004 are deployed and immutable.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Program settlement terms
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_program_settlement_terms (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id               uuid NOT NULL UNIQUE REFERENCES voucher_programs(id) ON DELETE RESTRICT,
  funding_party_type       text NOT NULL CHECK (funding_party_type IN ('akiba','merchant','sponsor','none')),
  funding_party_reference  text,
  settlement_currency      text NOT NULL DEFAULT 'cUSD' CHECK (trim(settlement_currency) <> ''),
  reimbursement_rate       numeric(9,8) NOT NULL CHECK (reimbursement_rate >= 0 AND reimbursement_rate <= 1),
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (funding_party_type IN ('sponsor','merchant') AND funding_party_reference IS NOT NULL AND trim(funding_party_reference) <> '')
    OR funding_party_type IN ('akiba','none')
  ),
  CHECK (
    (funding_party_type = 'none' AND reimbursement_rate = 0)
    OR funding_party_type <> 'none'
  )
);

CREATE INDEX IF NOT EXISTS idx_vpst_active ON voucher_program_settlement_terms(active);

ALTER TABLE voucher_program_settlement_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vpst_deny_anon ON voucher_program_settlement_terms;
CREATE POLICY vpst_deny_anon ON voucher_program_settlement_terms FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vpst_deny_auth ON voucher_program_settlement_terms;
CREATE POLICY vpst_deny_auth ON voucher_program_settlement_terms FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Immutable settlement ledger
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS voucher_settlement_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_voucher_id        uuid REFERENCES issued_vouchers(id) ON DELETE RESTRICT,
  voucher_redemption_id    uuid REFERENCES voucher_redemptions(id) ON DELETE RESTRICT,
  program_id               uuid REFERENCES voucher_programs(id) ON DELETE RESTRICT,
  merchant_id              uuid NOT NULL,
  funding_party_type       text NOT NULL CHECK (funding_party_type IN ('akiba','merchant','sponsor','none')),
  funding_party_reference  text,
  entry_type               text NOT NULL CHECK (entry_type IN ('payable_created','payable_reversed','adjustment')),
  gross_amount_cusd        numeric(20,6) NOT NULL CHECK (gross_amount_cusd >= 0),
  discount_amount_cusd     numeric(20,6) NOT NULL CHECK (discount_amount_cusd >= 0),
  reimbursement_rate       numeric(9,8) NOT NULL CHECK (reimbursement_rate >= 0 AND reimbursement_rate <= 1),
  payable_amount           numeric(20,6) NOT NULL,
  currency                 text NOT NULL,
  idempotency_key          text NOT NULL UNIQUE,
  metadata                 jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (entry_type = 'payable_created' AND payable_amount >= 0)
    OR entry_type IN ('payable_reversed','adjustment')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vse_redemption_payable
  ON voucher_settlement_entries(voucher_redemption_id)
  WHERE entry_type = 'payable_created' AND voucher_redemption_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vse_merchant_created ON voucher_settlement_entries(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vse_program ON voucher_settlement_entries(program_id);

CREATE OR REPLACE FUNCTION fn_financial_row_no_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_vse_no_mutation ON voucher_settlement_entries;
CREATE TRIGGER trg_vse_no_mutation
  BEFORE UPDATE OR DELETE ON voucher_settlement_entries
  FOR EACH ROW EXECUTE FUNCTION fn_financial_row_no_mutation();

ALTER TABLE voucher_settlement_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vse_deny_anon ON voucher_settlement_entries;
CREATE POLICY vse_deny_anon ON voucher_settlement_entries FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS vse_deny_auth ON voucher_settlement_entries;
CREATE POLICY vse_deny_auth ON voucher_settlement_entries FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Settlement batches
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS merchant_settlement_batches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL,
  currency              text NOT NULL,
  state                 text NOT NULL DEFAULT 'draft'
                        CHECK (state IN ('draft','approved','processing','paid','cancelled','failed')),
  item_count             integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total_payable_amount   numeric(20,6) NOT NULL DEFAULT 0 CHECK (total_payable_amount >= 0),
  idempotency_key       text NOT NULL UNIQUE,
  payment_reference     text,
  payment_evidence      jsonb,
  failure_reason        text,
  approved_at           timestamptz,
  processing_at         timestamptz,
  paid_at               timestamptz,
  cancelled_at          timestamptz,
  failed_at             timestamptz,
  created_by            text NOT NULL,
  updated_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msb_payment_reference
  ON merchant_settlement_batches(payment_reference)
  WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msb_partner_state ON merchant_settlement_batches(partner_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS merchant_settlement_batch_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             uuid NOT NULL REFERENCES merchant_settlement_batches(id) ON DELETE RESTRICT,
  settlement_entry_id  uuid NOT NULL REFERENCES voucher_settlement_entries(id) ON DELETE RESTRICT,
  payable_amount       numeric(20,6) NOT NULL,
  currency             text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, settlement_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_msbi_entry ON merchant_settlement_batch_items(settlement_entry_id);

CREATE TABLE IF NOT EXISTS merchant_settlement_batch_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES merchant_settlement_batches(id) ON DELETE RESTRICT,
  event_type  text NOT NULL CHECK (event_type IN ('created','approved','processing','paid','cancelled','failed')),
  actor_id    text NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msbe_batch_created
  ON merchant_settlement_batch_events(batch_id, created_at);

DROP TRIGGER IF EXISTS trg_msbe_no_mutation ON merchant_settlement_batch_events;
CREATE TRIGGER trg_msbe_no_mutation
  BEFORE UPDATE OR DELETE ON merchant_settlement_batch_events
  FOR EACH ROW EXECUTE FUNCTION fn_financial_row_no_mutation();

CREATE OR REPLACE FUNCTION fn_msbi_one_open_batch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM merchant_settlement_batch_items bi
      JOIN merchant_settlement_batches b ON b.id = bi.batch_id
     WHERE bi.settlement_entry_id = NEW.settlement_entry_id
       AND b.state <> 'cancelled'
       AND bi.batch_id <> NEW.batch_id
  ) THEN
    RAISE EXCEPTION 'PAYABLE_ALREADY_BATCHED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_msbi_one_open_batch ON merchant_settlement_batch_items;
CREATE TRIGGER trg_msbi_one_open_batch
  BEFORE INSERT OR UPDATE ON merchant_settlement_batch_items
  FOR EACH ROW EXECUTE FUNCTION fn_msbi_one_open_batch();

DROP TRIGGER IF EXISTS trg_msbi_no_mutation ON merchant_settlement_batch_items;
CREATE TRIGGER trg_msbi_no_mutation
  BEFORE UPDATE OR DELETE ON merchant_settlement_batch_items
  FOR EACH ROW EXECUTE FUNCTION fn_financial_row_no_mutation();

ALTER TABLE merchant_settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_settlement_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_settlement_batch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msb_deny_anon ON merchant_settlement_batches;
CREATE POLICY msb_deny_anon ON merchant_settlement_batches FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS msb_deny_auth ON merchant_settlement_batches;
CREATE POLICY msb_deny_auth ON merchant_settlement_batches FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS msbi_deny_anon ON merchant_settlement_batch_items;
CREATE POLICY msbi_deny_anon ON merchant_settlement_batch_items FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS msbi_deny_auth ON merchant_settlement_batch_items;
CREATE POLICY msbi_deny_auth ON merchant_settlement_batch_items FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS msbe_deny_anon ON merchant_settlement_batch_events;
CREATE POLICY msbe_deny_anon ON merchant_settlement_batch_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS msbe_deny_auth ON merchant_settlement_batch_events;
CREATE POLICY msbe_deny_auth ON merchant_settlement_batch_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Shared financial helpers
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_voucher_discount(
  p_rules_snapshot jsonb,
  p_gross_amount numeric
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_type text;
  v_discount numeric;
  v_cap numeric;
BEGIN
  IF p_gross_amount IS NULL OR p_gross_amount <= 0 OR p_gross_amount > 1000000 THEN
    RAISE EXCEPTION 'INVALID_GROSS_AMOUNT' USING ERRCODE = 'P0001';
  END IF;
  IF p_rules_snapshot IS NULL THEN
    RAISE EXCEPTION 'RULES_SNAPSHOT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_type := p_rules_snapshot->>'voucher_type';
  IF v_type IN ('percent','percent_off') THEN
    v_discount := p_gross_amount * COALESCE(NULLIF(p_rules_snapshot->>'discount_percent','')::numeric, 0) / 100;
  ELSIF v_type IN ('fixed','fixed_off') THEN
    v_discount := LEAST(p_gross_amount, COALESCE(NULLIF(p_rules_snapshot->>'discount_cusd','')::numeric, 0));
  ELSIF v_type IN ('free','free_product') THEN
    v_discount := LEAST(p_gross_amount, COALESCE(NULLIF(p_rules_snapshot->>'retail_value_cusd','')::numeric, p_gross_amount));
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_VOUCHER_TYPE' USING ERRCODE = 'P0001';
  END IF;

  v_cap := NULLIF(p_rules_snapshot->>'retail_value_cusd','')::numeric;
  IF v_cap IS NOT NULL THEN v_discount := LEAST(v_discount, v_cap); END IF;
  RETURN round(GREATEST(0, LEAST(v_discount, p_gross_amount)), 6);
END;
$$;

CREATE OR REPLACE FUNCTION create_voucher_payable(
  p_voucher_id uuid,
  p_redemption_id uuid,
  p_gross_amount numeric,
  p_discount_amount numeric,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset record;
  v_terms record;
  v_id uuid;
BEGIN
  SELECT program_id, merchant_id INTO v_asset
    FROM issued_vouchers WHERE id = p_voucher_id;
  IF NOT FOUND OR v_asset.program_id IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_PROGRAM_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_terms
    FROM voucher_program_settlement_terms
   WHERE program_id = v_asset.program_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTLEMENT_TERMS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO voucher_settlement_entries (
    issued_voucher_id, voucher_redemption_id, program_id, merchant_id,
    funding_party_type, funding_party_reference, entry_type,
    gross_amount_cusd, discount_amount_cusd, reimbursement_rate,
    payable_amount, currency, idempotency_key, metadata
  ) VALUES (
    p_voucher_id, p_redemption_id, v_asset.program_id, v_asset.merchant_id,
    v_terms.funding_party_type, v_terms.funding_party_reference, 'payable_created',
    round(p_gross_amount,6), round(p_discount_amount,6), v_terms.reimbursement_rate,
    round(p_discount_amount * v_terms.reimbursement_rate,6),
    v_terms.settlement_currency, p_idempotency_key, p_metadata
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM voucher_settlement_entries
     WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Program terms management and activation guard
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_program_settlement_terms(
  p_program_id uuid,
  p_partner_id uuid,
  p_funding_party_type text,
  p_funding_party_reference text,
  p_settlement_currency text,
  p_reimbursement_rate numeric,
  p_active boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid;
BEGIN
  SELECT svt.partner_id INTO v_partner
    FROM voucher_programs vp JOIN spend_voucher_templates svt ON svt.id=vp.template_id
   WHERE vp.id=p_program_id FOR UPDATE OF vp;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_partner_id IS NOT NULL AND v_partner IS DISTINCT FROM p_partner_id THEN
    RAISE EXCEPTION 'PROGRAM_PARTNER_MISMATCH' USING ERRCODE='P0001';
  END IF;
  INSERT INTO voucher_program_settlement_terms(
    program_id,funding_party_type,funding_party_reference,settlement_currency,reimbursement_rate,active
  ) VALUES (
    p_program_id,p_funding_party_type,p_funding_party_reference,COALESCE(NULLIF(trim(p_settlement_currency),''),'cUSD'),p_reimbursement_rate,COALESCE(p_active,true)
  )
  ON CONFLICT(program_id) DO UPDATE SET
    funding_party_type=EXCLUDED.funding_party_type,
    funding_party_reference=EXCLUDED.funding_party_reference,
    settlement_currency=EXCLUDED.settlement_currency,
    reimbursement_rate=EXCLUDED.reimbursement_rate,
    active=EXCLUDED.active,
    updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION create_voucher_program_with_settlement(
  p_name text,
  p_template_id uuid,
  p_funding_type text,
  p_sponsor text,
  p_total_cap integer,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_channels jsonb,
  p_merchant_user_id uuid,
  p_partner_id uuid,
  p_funding_party_type text,
  p_funding_party_reference text,
  p_settlement_currency text,
  p_reimbursement_rate numeric
) RETURNS TABLE(ok boolean,program_id uuid,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_created record;
BEGIN
  SELECT * INTO v_created FROM create_voucher_program(
    p_name,p_template_id,p_funding_type,p_sponsor,p_total_cap,p_start_at,p_end_at,
    p_channels,p_merchant_user_id,p_partner_id
  );
  PERFORM upsert_program_settlement_terms(
    v_created.program_id,p_partner_id,p_funding_party_type,p_funding_party_reference,
    p_settlement_currency,p_reimbursement_rate,true
  );
  INSERT INTO merchant_audit_log(merchant_user_id,partner_id,action,metadata)
  VALUES(
    p_merchant_user_id,p_partner_id,'program.settlement_terms_created',
    jsonb_build_object(
      'program_id',v_created.program_id,'funding_party_type',p_funding_party_type,
      'funding_party_reference',p_funding_party_reference,
      'settlement_currency',p_settlement_currency,'reimbursement_rate',p_reimbursement_rate
    )
  );
  RETURN QUERY SELECT true,v_created.program_id,''::text;
END;
$$;

CREATE OR REPLACE FUNCTION update_voucher_program_with_settlement(
  p_program_id uuid,
  p_merchant_user_id uuid,
  p_partner_id uuid,
  p_name text DEFAULT NULL,
  p_start_at timestamptz DEFAULT NULL,
  p_end_at timestamptz DEFAULT NULL,
  p_total_cap integer DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,
  p_channel_patches jsonb DEFAULT NULL,
  p_clear_end_at boolean DEFAULT false,
  p_clear_start_at boolean DEFAULT false,
  p_funding_party_type text DEFAULT NULL,
  p_funding_party_reference text DEFAULT NULL,
  p_settlement_currency text DEFAULT NULL,
  p_reimbursement_rate numeric DEFAULT NULL
) RETURNS TABLE(ok boolean,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_updated record;
BEGIN
  SELECT * INTO v_updated FROM update_voucher_program(
    p_program_id,p_merchant_user_id,p_partner_id,p_name,p_start_at,p_end_at,
    p_total_cap,p_template_id,p_channel_patches,p_clear_end_at,p_clear_start_at
  );
  IF p_funding_party_type IS NOT NULL OR p_reimbursement_rate IS NOT NULL THEN
    IF p_funding_party_type IS NULL OR p_reimbursement_rate IS NULL THEN
      RAISE EXCEPTION 'INCOMPLETE_SETTLEMENT_TERMS' USING ERRCODE='P0001';
    END IF;
    PERFORM upsert_program_settlement_terms(
      p_program_id,p_partner_id,p_funding_party_type,p_funding_party_reference,
      p_settlement_currency,p_reimbursement_rate,true
    );
    INSERT INTO merchant_audit_log(merchant_user_id,partner_id,action,metadata)
    VALUES(
      p_merchant_user_id,p_partner_id,'program.settlement_terms_updated',
      jsonb_build_object(
        'program_id',p_program_id,'funding_party_type',p_funding_party_type,
        'funding_party_reference',p_funding_party_reference,
        'settlement_currency',p_settlement_currency,'reimbursement_rate',p_reimbursement_rate
      )
    );
  END IF;
  RETURN QUERY SELECT true,''::text;
END;
$$;

CREATE OR REPLACE FUNCTION fn_program_activation_requires_settlement_terms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='active' AND OLD.state IS DISTINCT FROM 'active' AND NOT EXISTS (
    SELECT 1 FROM voucher_program_settlement_terms WHERE program_id=NEW.id AND active=true
  ) THEN
    RAISE EXCEPTION 'ACTIVATION_REQUIRES_SETTLEMENT_TERMS' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_program_activation_requires_settlement_terms ON voucher_programs;
CREATE TRIGGER trg_program_activation_requires_settlement_terms
  BEFORE UPDATE OF state ON voucher_programs
  FOR EACH ROW EXECUTE FUNCTION fn_program_activation_requires_settlement_terms();

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Replace merchant-scan redemption with exact amount + payable
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS redeem_voucher_in_store_atomic(text,uuid,uuid,text);

CREATE OR REPLACE FUNCTION redeem_voucher_in_store_atomic(
  p_token_hash text,
  p_partner_id uuid,
  p_merchant_user_id uuid,
  p_gross_amount_cusd numeric,
  p_external_reference text DEFAULT NULL
) RETURNS TABLE(ok boolean,voucher_id uuid,offer_title text,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_iv record; v_discount numeric; v_redemption_id uuid; v_title text;
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
  RETURN QUERY SELECT true,v_iv.id,v_title,''::text;
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. Replace online order redemption with payable creation
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,double precision,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[]
);

CREATE OR REPLACE FUNCTION place_hub_order_and_redeem_voucher(
  p_partner_id uuid,p_user_address text,p_item_name text,p_item_category text,
  p_product_id text,p_payment_ref text,p_payment_currency text,p_payment_method text,
  p_amount_cusd numeric,p_amount_kes integer,p_voucher_code text,p_voucher_id uuid,
  p_recipient_name text,p_phone text,p_city text,p_location_details text,
  p_hub_user_id uuid,p_merchant_id uuid,p_product_id_scope text,p_product_category text,
  p_discount_applied numeric,p_user_addresses text[]
) RETURNS TABLE(ok boolean,order_id uuid,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
    partner_id,user_address,status,item_name,item_category,product_id,payment_ref,
    payment_currency,payment_method,amount_cusd,amount_kes,voucher_code,voucher_id,
    recipient_name,phone,city,location_details
  ) VALUES(
    p_partner_id,p_user_address,'placed',p_item_name,p_item_category,p_product_id,p_payment_ref,
    p_payment_currency,p_payment_method,p_amount_cusd,p_amount_kes,p_voucher_code,p_voucher_id,
    p_recipient_name,p_phone,p_city,p_location_details
  ) RETURNING id INTO v_order_id;

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

REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,text,text,text,text,uuid,uuid,text,text,numeric,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION place_hub_order_and_redeem_voucher(uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,text,text,text,text,uuid,uuid,text,text,numeric,text[]) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. Batch and reconciliation RPCs
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_partner_settlement_batch(
  p_partner_id uuid,p_currency text,p_entry_ids uuid[],p_idempotency_key text,p_actor_id text
) RETURNS TABLE(batch_id uuid,item_count integer,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch uuid; v_count integer; v_total numeric;
BEGIN
  IF p_entry_ids IS NULL OR array_length(p_entry_ids,1) IS NULL THEN RAISE EXCEPTION 'NO_PAYABLES_SELECTED' USING ERRCODE='P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_partner_id::text||':'||p_currency));
  SELECT b.id,b.item_count,b.total_payable_amount INTO v_batch,v_count,v_total
    FROM merchant_settlement_batches b WHERE b.idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN QUERY SELECT v_batch,v_count,v_total; RETURN; END IF;

  PERFORM 1 FROM voucher_settlement_entries
   WHERE id=ANY(p_entry_ids) AND merchant_id=p_partner_id AND currency=p_currency
     AND entry_type IN ('payable_created','adjustment') FOR UPDATE;
  IF (SELECT count(*) FROM voucher_settlement_entries
       WHERE id=ANY(p_entry_ids) AND merchant_id=p_partner_id AND currency=p_currency
         AND entry_type IN ('payable_created','adjustment')) <> cardinality(p_entry_ids) THEN
    RAISE EXCEPTION 'INVALID_OR_CROSS_PARTNER_PAYABLE' USING ERRCODE='P0001';
  END IF;
  IF EXISTS(
    SELECT 1 FROM merchant_settlement_batch_items bi
    JOIN merchant_settlement_batches b ON b.id=bi.batch_id
    WHERE bi.settlement_entry_id=ANY(p_entry_ids) AND b.state<>'cancelled'
  ) THEN RAISE EXCEPTION 'PAYABLE_ALREADY_BATCHED' USING ERRCODE='P0001'; END IF;

  SELECT count(*),COALESCE(sum(payable_amount),0) INTO v_count,v_total
    FROM voucher_settlement_entries WHERE id=ANY(p_entry_ids);
  IF v_total<0 THEN RAISE EXCEPTION 'NEGATIVE_BATCH_TOTAL' USING ERRCODE='P0001'; END IF;
  INSERT INTO merchant_settlement_batches(
    partner_id,currency,item_count,total_payable_amount,idempotency_key,created_by
  ) VALUES(p_partner_id,p_currency,v_count,v_total,p_idempotency_key,p_actor_id)
  RETURNING id INTO v_batch;
  INSERT INTO merchant_settlement_batch_items(batch_id,settlement_entry_id,payable_amount,currency)
  SELECT v_batch,id,payable_amount,currency FROM voucher_settlement_entries WHERE id=ANY(p_entry_ids);
  INSERT INTO merchant_settlement_batch_events(batch_id,event_type,actor_id,metadata)
  VALUES(v_batch,'created',p_actor_id,jsonb_build_object('item_count',v_count,'total_amount',v_total));
  RETURN QUERY SELECT v_batch,v_count,v_total;
END;
$$;

CREATE OR REPLACE FUNCTION transition_partner_settlement_batch(
  p_batch_id uuid,p_new_state text,p_actor_id text,p_payment_reference text DEFAULT NULL,p_payment_evidence jsonb DEFAULT NULL
) RETURNS TABLE(ok boolean,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM merchant_settlement_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF NOT (
    (v.state='draft' AND p_new_state IN ('approved','cancelled')) OR
    (v.state='approved' AND p_new_state IN ('processing','cancelled')) OR
    (v.state='processing' AND p_new_state IN ('paid','failed')) OR
    (v.state='failed' AND p_new_state='processing')
  ) THEN RAISE EXCEPTION 'INVALID_BATCH_TRANSITION: % -> %',v.state,p_new_state USING ERRCODE='P0001'; END IF;
  IF p_new_state='paid' AND (p_payment_reference IS NULL OR trim(p_payment_reference)='' OR p_payment_evidence IS NULL) THEN
    RAISE EXCEPTION 'PAYMENT_EVIDENCE_REQUIRED' USING ERRCODE='P0001';
  END IF;
  UPDATE merchant_settlement_batches SET
    state=p_new_state,updated_by=p_actor_id,updated_at=now(),
    approved_at=CASE WHEN p_new_state='approved' THEN now() ELSE approved_at END,
    processing_at=CASE WHEN p_new_state='processing' THEN now() ELSE processing_at END,
    paid_at=CASE WHEN p_new_state='paid' THEN now() ELSE paid_at END,
    cancelled_at=CASE WHEN p_new_state='cancelled' THEN now() ELSE cancelled_at END,
    failed_at=CASE WHEN p_new_state='failed' THEN now() ELSE failed_at END,
    payment_reference=CASE WHEN p_new_state='paid' THEN p_payment_reference ELSE payment_reference END,
    payment_evidence=CASE WHEN p_new_state='paid' THEN p_payment_evidence ELSE payment_evidence END
  WHERE id=p_batch_id;
  INSERT INTO merchant_settlement_batch_events(batch_id,event_type,actor_id,metadata)
  VALUES(
    p_batch_id,p_new_state,p_actor_id,
    CASE WHEN p_new_state='paid'
      THEN jsonb_build_object('payment_reference',p_payment_reference,'payment_evidence',p_payment_evidence)
      ELSE '{}'::jsonb END
  );
  RETURN QUERY SELECT true,p_new_state;
END;
$$;

CREATE OR REPLACE FUNCTION record_settlement_failure(p_batch_id uuid,p_reason text,p_actor_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM merchant_settlement_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_state<>'processing' THEN
    RAISE EXCEPTION 'INVALID_BATCH_TRANSITION: % -> failed',v_state USING ERRCODE='P0001';
  END IF;
  IF trim(COALESCE(p_reason,''))='' THEN
    RAISE EXCEPTION 'FAILURE_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  UPDATE merchant_settlement_batches SET
    state='failed',failure_reason=p_reason,failed_at=now(),updated_at=now(),updated_by=p_actor_id
  WHERE id=p_batch_id;
  INSERT INTO merchant_settlement_batch_events(batch_id,event_type,actor_id,metadata)
  VALUES(p_batch_id,'failed',p_actor_id,jsonb_build_object('failure_reason',p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION add_settlement_adjustment(
  p_partner_id uuid,p_program_id uuid,p_amount numeric,p_currency text,p_reason text,p_idempotency_key text,p_actor_id text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_terms record;
BEGIN
  SELECT * INTO v_terms FROM voucher_program_settlement_terms WHERE program_id=p_program_id AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_TERMS_REQUIRED' USING ERRCODE='P0001'; END IF;
  INSERT INTO voucher_settlement_entries(
    program_id,merchant_id,funding_party_type,funding_party_reference,entry_type,
    gross_amount_cusd,discount_amount_cusd,reimbursement_rate,payable_amount,currency,idempotency_key,metadata
  ) VALUES(
    p_program_id,p_partner_id,v_terms.funding_party_type,v_terms.funding_party_reference,'adjustment',
    0,0,v_terms.reimbursement_rate,p_amount,p_currency,p_idempotency_key,
    jsonb_build_object('reason',p_reason,'actor_id',p_actor_id)
  ) ON CONFLICT(idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM voucher_settlement_entries
     WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_reconciliation_incident(p_incident_id uuid,p_resolution jsonb,p_actor_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE reconciliation_incidents SET
    resolved=true,
    data=COALESCE(data,'{}'::jsonb)||jsonb_build_object('resolution',p_resolution,'resolved_by',p_actor_id,'resolved_at',now())
  WHERE id=p_incident_id AND resolved=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'INCIDENT_NOT_FOUND_OR_RESOLVED' USING ERRCODE='P0001'; END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. Reporting views
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_unbatched_voucher_payables AS
SELECT e.*
FROM voucher_settlement_entries e
WHERE e.entry_type IN ('payable_created','adjustment')
  AND NOT EXISTS(
    SELECT 1 FROM merchant_settlement_batch_items bi
    JOIN merchant_settlement_batches b ON b.id=bi.batch_id
    WHERE bi.settlement_entry_id=e.id AND b.state<>'cancelled'
  );

CREATE OR REPLACE VIEW v_partner_voucher_payable_balances AS
WITH active_items AS (
  SELECT bi.settlement_entry_id,b.state
  FROM merchant_settlement_batch_items bi
  JOIN merchant_settlement_batches b ON b.id=bi.batch_id
  WHERE b.state<>'cancelled'
)
SELECT e.merchant_id AS partner_id,e.currency,
  COALESCE(sum(e.payable_amount) FILTER(WHERE ai.settlement_entry_id IS NULL),0)::numeric AS pending_amount,
  COALESCE(sum(e.payable_amount) FILTER(WHERE ai.state IN ('draft','approved','processing','failed')),0)::numeric AS batched_amount,
  COALESCE(sum(e.payable_amount) FILTER(WHERE ai.state='paid'),0)::numeric AS paid_amount
FROM voucher_settlement_entries e
LEFT JOIN active_items ai ON ai.settlement_entry_id=e.id
WHERE e.entry_type IN ('payable_created','adjustment')
GROUP BY e.merchant_id,e.currency;

CREATE OR REPLACE VIEW v_program_voucher_liability AS
SELECT e.program_id,e.merchant_id,e.currency,count(*) AS entry_count,
  sum(e.discount_amount_cusd)::numeric AS redeemed_discount,
  sum(e.payable_amount)::numeric AS payable_liability
FROM voucher_settlement_entries e GROUP BY e.program_id,e.merchant_id,e.currency;

CREATE OR REPLACE VIEW v_voucher_settlement_aging AS
SELECT e.id,e.merchant_id,e.program_id,e.currency,e.payable_amount,e.created_at,
  floor(extract(epoch FROM(now()-e.created_at))/86400)::integer AS age_days
FROM v_unbatched_voucher_payables e;

CREATE OR REPLACE VIEW v_open_voucher_reconciliation_incidents AS
SELECT id,type,voucher_id,order_id,data,created_at
FROM reconciliation_incidents WHERE resolved=false;

CREATE OR REPLACE VIEW v_partner_settlement_batches AS
SELECT id,partner_id,currency,state,item_count,total_payable_amount,
       payment_reference,failure_reason,approved_at,processing_at,paid_at,
       cancelled_at,failed_at,created_at,updated_at
FROM merchant_settlement_batches;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. Safe legacy backfill
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO voucher_settlement_entries(
  issued_voucher_id,voucher_redemption_id,program_id,merchant_id,
  funding_party_type,funding_party_reference,entry_type,gross_amount_cusd,
  discount_amount_cusd,reimbursement_rate,payable_amount,currency,idempotency_key,metadata
)
SELECT iv.id,vr.id,iv.program_id,vr.merchant_id,t.funding_party_type,t.funding_party_reference,
  'payable_created',round(mt.amount_cusd::numeric+vr.discount_applied,6),vr.discount_applied,
  t.reimbursement_rate,round(vr.discount_applied*t.reimbursement_rate,6),
  t.settlement_currency,'backfill:redemption:'||vr.id::text,jsonb_build_object('backfilled',true)
FROM voucher_redemptions vr
JOIN issued_vouchers iv ON iv.id=vr.issued_voucher_id
JOIN voucher_program_settlement_terms t ON t.program_id=iv.program_id AND t.active=true
JOIN merchant_transactions mt ON mt.id::text=vr.order_id
WHERE vr.redemption_channel='online_order'
ON CONFLICT DO NOTHING;

INSERT INTO reconciliation_incidents(type,voucher_id,order_id,data)
SELECT 'voucher_settlement_backfill_ambiguous',iv.id,vr.order_id,
  jsonb_build_object('redemption_id',vr.id,'reason',
    CASE WHEN iv.program_id IS NULL THEN 'program_missing'
         WHEN t.program_id IS NULL THEN 'settlement_terms_missing'
         WHEN vr.redemption_channel='merchant_scan' THEN 'gross_amount_missing'
         ELSE 'order_amount_missing' END)
FROM voucher_redemptions vr
JOIN issued_vouchers iv ON iv.id=vr.issued_voucher_id
LEFT JOIN voucher_program_settlement_terms t ON t.program_id=iv.program_id AND t.active=true
LEFT JOIN merchant_transactions mt ON mt.id::text=vr.order_id
WHERE NOT EXISTS(SELECT 1 FROM voucher_settlement_entries e WHERE e.voucher_redemption_id=vr.id)
  AND NOT EXISTS(
    SELECT 1 FROM reconciliation_incidents ri
    WHERE ri.type='voucher_settlement_backfill_ambiguous'
      AND ri.data->>'redemption_id'=vr.id::text
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. Privileges
-- ══════════════════════════════════════════════════════════════════════════════

GRANT SELECT,INSERT,UPDATE ON voucher_program_settlement_terms TO service_role;
GRANT SELECT,INSERT ON voucher_settlement_entries TO service_role;
GRANT SELECT,INSERT,UPDATE ON merchant_settlement_batches TO service_role;
GRANT SELECT,INSERT ON merchant_settlement_batch_items TO service_role;
GRANT SELECT,INSERT ON merchant_settlement_batch_events TO service_role;
GRANT SELECT ON v_unbatched_voucher_payables,v_partner_voucher_payable_balances,
  v_program_voucher_liability,v_voucher_settlement_aging,v_open_voucher_reconciliation_incidents,
  v_partner_settlement_batches TO service_role;

REVOKE ALL ON FUNCTION calculate_voucher_discount(jsonb,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION create_voucher_payable(uuid,uuid,numeric,numeric,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION upsert_program_settlement_terms(uuid,uuid,text,text,text,numeric,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION create_voucher_program_with_settlement(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,uuid,uuid,text,text,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION update_voucher_program_with_settlement(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,uuid,jsonb,boolean,boolean,text,text,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION create_partner_settlement_batch(uuid,text,uuid[],text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION transition_partner_settlement_batch(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION record_settlement_failure(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION add_settlement_adjustment(uuid,uuid,numeric,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION resolve_reconciliation_incident(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION calculate_voucher_discount(jsonb,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION create_voucher_payable(uuid,uuid,numeric,numeric,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION upsert_program_settlement_terms(uuid,uuid,text,text,text,numeric,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION create_voucher_program_with_settlement(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,uuid,uuid,text,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION update_voucher_program_with_settlement(uuid,uuid,uuid,text,timestamptz,timestamptz,integer,uuid,jsonb,boolean,boolean,text,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION create_partner_settlement_batch(uuid,text,uuid[],text,text) TO service_role;
GRANT EXECUTE ON FUNCTION transition_partner_settlement_batch(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION record_settlement_failure(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION add_settlement_adjustment(uuid,uuid,numeric,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_reconciliation_incident(uuid,jsonb,text) TO service_role;
