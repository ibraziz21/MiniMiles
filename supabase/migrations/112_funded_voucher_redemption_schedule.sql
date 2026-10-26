-- Independent of claim eligibility: a member may claim any day, while the
-- merchant may redeem only on the days in the issued voucher's snapshot.
-- Stored in allocation metadata to retain the existing authoring RPCs.
CREATE OR REPLACE FUNCTION validate_funded_redemption_schedule(p_schedule jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_day jsonb; v_zone text;
BEGIN
  IF p_schedule IS NULL OR p_schedule='null'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(p_schedule) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
  END IF;
  IF jsonb_typeof(p_schedule->'days') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
  END IF;
  IF jsonb_array_length(p_schedule->'days') NOT BETWEEN 1 AND 7 THEN
    RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
  END IF;
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_schedule->'days') LOOP
    IF jsonb_typeof(v_day) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
    END IF;
    IF (v_day#>>'{}')::numeric<>floor((v_day#>>'{}')::numeric)
       OR (v_day#>>'{}')::numeric NOT BETWEEN 0 AND 6 THEN
      RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_schedule->'days'))
     <>jsonb_array_length(p_schedule->'days') THEN
    RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
  END IF;
  v_zone:=COALESCE(p_schedule->>'timezone','Africa/Nairobi');
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_zone) THEN
    RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION funded_redemption_day_allowed(p_schedule jsonb,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_dow integer;
BEGIN
  PERFORM validate_funded_redemption_schedule(p_schedule);
  IF p_schedule IS NULL OR p_schedule='null'::jsonb THEN RETURN true; END IF;
  IF p_at IS NULL THEN RETURN false; END IF;
  v_dow:=extract(dow FROM p_at AT TIME ZONE COALESCE(p_schedule->>'timezone','Africa/Nairobi'));
  RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_schedule->'days') day(value) WHERE value::numeric=v_dow);
END; $$;

CREATE OR REPLACE FUNCTION validate_funded_allocation_redemption_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM validate_funded_redemption_schedule(NEW.metadata->'redemption_schedule');
  IF TG_OP='UPDATE' THEN
    IF (NEW.metadata->'redemption_schedule') IS DISTINCT FROM (OLD.metadata->'redemption_schedule')
       AND (OLD.state<>'draft' OR EXISTS(SELECT 1 FROM issued_vouchers WHERE funding_allocation_id=OLD.id)) THEN
      RAISE EXCEPTION 'REDEMPTION_SCHEDULE_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_funded_allocation_redemption_schedule ON voucher_funding_allocations;
CREATE TRIGGER trg_funded_allocation_redemption_schedule
  BEFORE INSERT OR UPDATE OF metadata ON voucher_funding_allocations
  FOR EACH ROW EXECUTE FUNCTION validate_funded_allocation_redemption_schedule();

CREATE OR REPLACE FUNCTION snapshot_funded_redemption_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_schedule jsonb;
BEGIN
  IF NEW.funding_allocation_id IS NOT NULL AND NEW.funding_mode='akiba_reimbursement' THEN
    SELECT metadata->'redemption_schedule' INTO v_schedule FROM voucher_funding_allocations
      WHERE id=NEW.funding_allocation_id;
    PERFORM validate_funded_redemption_schedule(v_schedule);
    -- The allocation is authoritative, not a caller-supplied snapshot.
    NEW.rules_snapshot:=COALESCE(NEW.rules_snapshot,'{}'::jsonb)-'redemption_schedule';
    IF v_schedule IS NOT NULL AND v_schedule<>'null'::jsonb THEN
      NEW.rules_snapshot:=NEW.rules_snapshot||jsonb_build_object('redemption_schedule',v_schedule);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_snapshot_funded_redemption_schedule ON issued_vouchers;
CREATE TRIGGER trg_snapshot_funded_redemption_schedule BEFORE INSERT ON issued_vouchers
  FOR EACH ROW EXECUTE FUNCTION snapshot_funded_redemption_schedule();

CREATE OR REPLACE FUNCTION enforce_funded_redemption_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_voucher issued_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_voucher FROM issued_vouchers WHERE id=NEW.issued_voucher_id;
  IF FOUND AND v_voucher.funding_mode='akiba_reimbursement' THEN
    -- Use the server clock, never NEW.redeemed_at or a caller's occurred_at.
    -- Runs inside the atomic redemption transaction: refusal rolls back the
    -- purchase/Miles credit too. Idempotent replays do not insert again, so a
    -- Monday retry of a committed Sunday redemption still returns its result.
    IF NOT funded_redemption_day_allowed(v_voucher.rules_snapshot->'redemption_schedule',clock_timestamp()) THEN
      RAISE EXCEPTION 'REDEMPTION_DAY_NOT_ALLOWED';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_enforce_funded_redemption_schedule ON voucher_redemptions;
CREATE TRIGGER trg_enforce_funded_redemption_schedule BEFORE INSERT ON voucher_redemptions
  FOR EACH ROW EXECUTE FUNCTION enforce_funded_redemption_schedule();

REVOKE ALL ON FUNCTION validate_funded_redemption_schedule(jsonb),
  funded_redemption_day_allowed(jsonb,timestamptz),validate_funded_allocation_redemption_schedule(),
  snapshot_funded_redemption_schedule(),enforce_funded_redemption_schedule()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION validate_funded_redemption_schedule(jsonb),
  funded_redemption_day_allowed(jsonb,timestamptz) TO service_role;
