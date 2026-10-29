-- Optional inclusive local event dates, immutable at issue. Existing weekday-only vouchers are unchanged.
-- Independent of claim eligibility: a member may claim any day, while the
-- merchant may redeem only on the days in the issued voucher's snapshot.
-- Stored in allocation metadata to retain the existing authoring RPCs.
CREATE OR REPLACE FUNCTION validate_funded_redemption_schedule(p_schedule jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_day jsonb; v_zone text; v_start date; v_end date;
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
  IF p_schedule ? 'startDate' OR p_schedule ? 'endDate' THEN
    IF jsonb_typeof(p_schedule->'startDate') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_schedule->'endDate') IS DISTINCT FROM 'string'
       OR (p_schedule->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$'
       OR (p_schedule->>'endDate') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
    END IF;
    BEGIN
      v_start:=(p_schedule->>'startDate')::date; v_end:=(p_schedule->>'endDate')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
    END;
    IF v_start>v_end OR v_start::text<>p_schedule->>'startDate' OR v_end::text<>p_schedule->>'endDate' THEN
      RAISE EXCEPTION 'INVALID_REDEMPTION_SCHEDULE';
    END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION funded_redemption_day_allowed(p_schedule jsonb,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_dow integer; v_date date;
BEGIN
  PERFORM validate_funded_redemption_schedule(p_schedule);
  IF p_schedule IS NULL OR p_schedule='null'::jsonb THEN RETURN true; END IF;
  IF p_at IS NULL THEN RETURN false; END IF;
  v_date:=(p_at AT TIME ZONE COALESCE(p_schedule->>'timezone','Africa/Nairobi'))::date;
  IF p_schedule ? 'startDate' AND (v_date<(p_schedule->>'startDate')::date OR v_date>(p_schedule->>'endDate')::date) THEN RETURN false; END IF;
  v_dow:=extract(dow FROM p_at AT TIME ZONE COALESCE(p_schedule->>'timezone','Africa/Nairobi'));
  RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_schedule->'days') day(value) WHERE value::numeric=v_dow);
END; $$;

CREATE OR REPLACE FUNCTION snapshot_funded_redemption_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_schedule jsonb; v_end timestamptz;
BEGIN
  IF NEW.funding_allocation_id IS NOT NULL AND NEW.funding_mode='akiba_reimbursement' THEN
    SELECT metadata->'redemption_schedule' INTO v_schedule FROM voucher_funding_allocations
      WHERE id=NEW.funding_allocation_id;
    PERFORM validate_funded_redemption_schedule(v_schedule);
    -- The allocation is authoritative, not a caller-supplied snapshot.
    NEW.rules_snapshot:=COALESCE(NEW.rules_snapshot,'{}'::jsonb)-'redemption_schedule';
    IF v_schedule IS NOT NULL AND v_schedule<>'null'::jsonb THEN
      NEW.rules_snapshot:=NEW.rules_snapshot||jsonb_build_object('redemption_schedule',v_schedule);
      IF v_schedule ? 'endDate' THEN
        v_end:=(((v_schedule->>'endDate')::date+1)::timestamp AT TIME ZONE COALESCE(v_schedule->>'timezone','Africa/Nairobi'))-interval '1 millisecond';
        IF v_end<=clock_timestamp() THEN RAISE EXCEPTION 'REDEMPTION_WINDOW_CLOSED'; END IF;
        NEW.expires_at:=LEAST(COALESCE(NEW.expires_at,v_end),v_end);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- CREATE OR REPLACE preserves the existing private function ACLs.
