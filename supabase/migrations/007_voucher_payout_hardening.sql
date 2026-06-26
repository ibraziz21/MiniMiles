-- ============================================================================
-- 007 — Voucher Platform: Phase 5 Payout Production Hardening
-- ============================================================================
-- Idempotent (all statements use IF NOT EXISTS / CREATE OR REPLACE / ALTER COLUMN).
-- Migrations 001-006 are immutable; this migration only extends them.
-- ============================================================================

-- ── Section 0: Destination approval metadata used by admin UI ───────────────
ALTER TABLE merchant_payout_destinations
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cooling_expires_at timestamptz;

UPDATE merchant_payout_destinations
   SET is_approved = true
 WHERE approved_at IS NOT NULL
   AND is_approved = false;

UPDATE merchant_payout_destinations
   SET cooling_expires_at = last_modified_at + interval '24 hours'
 WHERE cooling_expires_at IS NULL;

-- ── Section 1: Payment evidence columns on payout instructions ───────────────
ALTER TABLE settlement_payout_instructions
  ADD COLUMN IF NOT EXISTS payment_method   text,
  ADD COLUMN IF NOT EXISTS payment_date     date,
  ADD COLUMN IF NOT EXISTS evidence_note    text,
  ADD COLUMN IF NOT EXISTS confirming_actor text;

-- ── Section 2: Receipt number sequence ──────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS payout_receipt_seq START 10000 INCREMENT 1;

-- ── Section 3: One-active-destination-per-partner-per-type trigger ───────────
CREATE OR REPLACE FUNCTION fn_one_active_dest_per_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- When a destination is being set to active, deactivate any other active
  -- destination for the same partner + destination_type.
  IF NEW.is_active = true THEN
    UPDATE merchant_payout_destinations
       SET is_active = false
     WHERE partner_id        = NEW.partner_id
       AND destination_type  = NEW.destination_type
       AND is_active         = true
       AND id               <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_one_active_dest_per_type ON merchant_payout_destinations;
CREATE TRIGGER trg_one_active_dest_per_type
  BEFORE INSERT OR UPDATE ON merchant_payout_destinations
  FOR EACH ROW EXECUTE FUNCTION fn_one_active_dest_per_type();

-- ── Section 4: Updated record_payout_confirmation (8-param) ─────────────────
-- Replace the 5-param version from 006. Caller must now supply payment evidence.
-- The old 5-param version is also retained via default params for backwards compat.

CREATE OR REPLACE FUNCTION record_payout_confirmation(
  p_instruction_id     uuid,
  p_actor              text,
  p_provider_reference text,
  p_confirmed_amount   numeric,
  p_confirmed_currency text,
  p_payment_method     text    DEFAULT NULL,
  p_payment_date       date    DEFAULT NULL,
  p_evidence_note      text    DEFAULT NULL
) RETURNS TABLE(ok boolean, receipt_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v               record;
  v_attempt       integer;
  v_incident      uuid;
  v_receipt_num   text;
BEGIN
  SELECT * INTO v FROM settlement_payout_instructions WHERE id = p_instruction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  -- Idempotent: already confirmed → return current receipt number.
  IF v.state = 'confirmed' THEN
    RETURN QUERY
      SELECT true,
             (SELECT metadata->>'receipt_number'
                FROM settlement_payout_events
               WHERE instruction_id = p_instruction_id AND event_type = 'confirmed'
               ORDER BY created_at DESC LIMIT 1);
    RETURN;
  END IF;

  IF v.state NOT IN ('submitted','uncertain') THEN
    RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE = 'P0001';
  END IF;

  -- Amount mismatch → incident + event + reject.
  IF p_confirmed_amount IS NOT NULL AND abs(p_confirmed_amount - v.amount) > 0.01 THEN
    INSERT INTO reconciliation_incidents(type, data)
    VALUES ('payout_amount_mismatch', jsonb_build_object(
      'instruction_id', p_instruction_id,
      'expected',       v.amount,
      'confirmed',      p_confirmed_amount))
    RETURNING id INTO v_incident;

    INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
    VALUES (p_instruction_id, 'incident_created', p_actor,
            jsonb_build_object('incident_id', v_incident, 'reason', 'amount_mismatch'));

    RAISE EXCEPTION 'AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirmed_currency IS NOT NULL AND p_confirmed_currency <> v.currency THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(attempt_number), 0) + 1 INTO v_attempt
    FROM settlement_payout_attempts WHERE instruction_id = p_instruction_id;

  v_receipt_num := 'RCP-' || to_char(now(), 'YYMMDD') || '-' ||
                   lpad(nextval('payout_receipt_seq')::text, 6, '0');

  UPDATE settlement_payout_instructions
     SET state             = 'confirmed',
         confirmed_at      = now(),
         provider_reference = COALESCE(p_provider_reference, provider_reference),
         payment_method    = COALESCE(p_payment_method, payment_method),
         payment_date      = COALESCE(p_payment_date, now()::date),
         evidence_note     = COALESCE(p_evidence_note, evidence_note),
         confirming_actor  = p_actor,
         updated_at        = now()
   WHERE id = p_instruction_id;

  UPDATE merchant_settlement_batches
     SET state        = 'paid',
         paid_at      = now(),
         confirmed_at = now(),
         updated_at   = now(),
         updated_by   = p_actor
   WHERE id = v.batch_id;

  INSERT INTO settlement_payout_attempts(
    instruction_id, attempt_number, provider_name, provider_reference,
    status, amount, currency, actor_id
  ) VALUES (
    p_instruction_id, v_attempt, v.provider_name,
    COALESCE(p_provider_reference, v.provider_reference),
    'confirmed', v.amount, v.currency, p_actor
  );

  INSERT INTO settlement_payout_events(instruction_id, event_type, actor_id, metadata)
  VALUES (p_instruction_id, 'confirmed', p_actor,
    jsonb_build_object(
      'confirmed_amount',  p_confirmed_amount,
      'currency',          p_confirmed_currency,
      'payment_method',    p_payment_method,
      'payment_date',      p_payment_date,
      'receipt_number',    v_receipt_num
    ));

  INSERT INTO merchant_settlement_batch_events(batch_id, event_type, actor_id, metadata)
  VALUES (v.batch_id, 'paid', p_actor,
    jsonb_build_object(
      'instruction_id', p_instruction_id,
      'receipt_number', v_receipt_num
    ));

  RETURN QUERY SELECT true, v_receipt_num;
END;
$$;

REVOKE ALL ON FUNCTION record_payout_confirmation(uuid,text,text,numeric,text,text,date,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_payout_confirmation(uuid,text,text,numeric,text,text,date,text)
  TO service_role;

-- ── Section 5: Payout receipt view ──────────────────────────────────────────
-- Safe view: no encrypted_destination, no private keys, no raw financial data
-- other than amount+currency needed for the receipt.
CREATE OR REPLACE VIEW v_payout_receipt AS
SELECT
  spi.id                     AS instruction_id,
  spi.batch_id,
  spi.provider_name,
  spi.provider_reference,
  spi.payment_method,
  spi.payment_date,
  spi.evidence_note,
  spi.confirming_actor,
  spi.amount,
  spi.currency,
  spi.confirmed_at,
  mpd.display_name           AS destination_display_name,
  mpd.destination_summary    AS destination_redacted,
  mpd.destination_type,
  mpd.partner_id,
  msb.total_payable_amount   AS batch_total,
  msb.item_count             AS batch_item_count,
  (SELECT e.metadata->>'receipt_number'
     FROM settlement_payout_events e
    WHERE e.instruction_id = spi.id
      AND e.event_type = 'confirmed'
    ORDER BY e.created_at DESC LIMIT 1) AS receipt_number
FROM settlement_payout_instructions spi
JOIN merchant_payout_destinations   mpd ON mpd.id = spi.destination_id
JOIN merchant_settlement_batches    msb ON msb.id = spi.batch_id
WHERE spi.state = 'confirmed';

-- ── Section 6: verify_payout_destination helper ──────────────────────────────
-- Admin verifies a destination before formal approval.
CREATE OR REPLACE FUNCTION verify_payout_destination(
  p_destination_id uuid,
  p_actor          text,
  p_actor_type     text DEFAULT 'admin'
) RETURNS TABLE(ok boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dest record;
BEGIN
  SELECT id, verified_at INTO v_dest
    FROM merchant_payout_destinations
   WHERE id = p_destination_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESTINATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_dest.verified_at IS NULL THEN
    UPDATE merchant_payout_destinations
       SET verified_at         = now(),
           verified_by         = p_actor,
           last_modified_at    = now(),
           cooling_expires_at  = now() + interval '24 hours'
     WHERE id = p_destination_id;
  END IF;

  -- Admin verification is audited by the admin API route via admin_audit_logs.
  -- Do not write here to merchant_audit_log: production merchant_audit_log has
  -- only merchant_user_id, partner_id, action, order_id, metadata, created_at.

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION verify_payout_destination(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_payout_destination(uuid,text,text) TO service_role;

-- ── Section 7: approve_payout_destination helper with 007 metadata ───────────
-- Overrides 006 to also maintain is_approved and cooling_expires_at.
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
     SET approved_at        = COALESCE(approved_at, now()),
         approved_by        = COALESCE(approved_by, p_actor),
         is_approved        = true,
         is_active          = true,
         last_modified_at   = now(),
         cooling_expires_at = now() + interval '24 hours'
   WHERE id = p_destination_id;

  -- Approval is an admin action audited via writeAdminAuditLog in the API route.
  -- merchant_audit_log.merchant_user_id is NOT NULL, so we do not write there.

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION approve_payout_destination(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_payout_destination(uuid,text,text) TO service_role;
