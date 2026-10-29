-- 110_funded_percent_vouchers_weekend_claims.sql
--
-- Two additions to the Akiba-funded claim path, both required by a
-- percentage-benefit acquisition offer that Akiba reimburses (first use:
-- Arabica Coffee House, 10% off capped at KES 200, Saturdays and Sundays).
--
-- 1. The claim-time rules snapshot now carries discount_percent and
--    maximum_discount_kes. The till function that actually computes the
--    discount — redeem_kes_voucher_and_award_atomic, Akiba-Platform
--    migration 120 — reads the benefit out of this snapshot and RAISEs
--    INVALID_PERCENT_VOUCHER_SNAPSHOT when either field is absent. Before
--    this migration the snapshot copied only discount_kes/minimum_spend_kes,
--    so a percent-benefit funded voucher could be claimed and then failed at
--    the counter. The snapshot is the authority at redemption, not the
--    template, so it has to be complete at claim time.
--
-- 2. A claim_day_of_week eligibility rule. The allocation's claim window is a
--    single [claim_starts_at, claim_ends_at) range with no recurrence, so a
--    standing "weekends only" offer previously meant one allocation, one
--    template and one approval cycle per weekend. The rule gates the claim on
--    the local calendar day instead, letting one allocation span the whole run
--    while only being claimable Sat/Sun. The day is evaluated in the rule's
--    own timezone (default Africa/Nairobi) because "Saturday" is a local-
--    calendar claim: a Nairobi Saturday opens at 21:00 UTC on Friday.
--
--    Like every other rule type it fails closed — malformed days, an
--    unrecognised timezone, or an empty list all leave the rule unsatisfied
--    rather than degrading to "any day". The matching allow-list in
--    validate_funded_voucher_rule_set_row is extended in the same migration,
--    below; the CASE here and that allow-list are one vocabulary and must
--    never be edited apart.
--
-- 3. A fix for no_prior_merchant_redemption, which has never worked: it
--    referenced voucher_redemptions.merchant_id unqualified, and merchant_id
--    is also a RETURNS TABLE output column of this function, so every claim
--    against an allocation carrying that rule raised SQLSTATE 42702. Found by
--    the integration test added with this migration. It matters here because
--    that rule is what makes a funded offer acquisition spend rather than a
--    discount for existing regulars, so the Arabica allocation depends on it.
--
-- WHERE THIS FUNCTION LIVES: claim_akiba_funded_voucher_atomic is defined in
-- BOTH repositories against the same Postgres project — Akiba-Platform
-- 118/126/147/148 and MiniMiles 098. This migration continues the chain here
-- because MiniMiles 098 was authored last and carries 148's hardening
-- forward, so it is the successor rather than a fork; changing the Platform
-- copy instead could apply cleanly and silently do nothing.
--
-- That reasoning is from authoring order, NOT from any database. Before
-- relying on it in an environment, read what is actually installed:
--   SELECT pg_get_functiondef(oid) FROM pg_proc
--    WHERE proname='claim_akiba_funded_voucher_atomic';
-- See docs/BDR-005.
--
-- The function remains executable only by service_role.

CREATE OR REPLACE FUNCTION claim_akiba_funded_voucher_atomic(
  p_allocation_id UUID,p_canonical_id UUID,p_claim_mode TEXT,p_idempotency_key TEXT,
  p_hub_user_id UUID,p_user_address TEXT,
  p_rule_set_id UUID,p_rule_set_version INTEGER,
  p_eligibility_snapshot JSONB,p_evidence_refs JSONB,
  p_country_code TEXT,p_country_assurance TEXT,
  p_actor_type TEXT,p_actor_id TEXT
) RETURNS TABLE(
  ok BOOLEAN,voucher_id UUID,claim_id UUID,out_allocation_id UUID,merchant_id UUID,
  voucher_status TEXT,expires_at TIMESTAMPTZ,idempotent BOOLEAN,error_code TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_alloc voucher_funding_allocations%ROWTYPE;
  v_program voucher_funding_programs%ROWTYPE;
  v_template spend_voucher_templates%ROWTYPE;
  v_partner RECORD;
  v_existing_claim voucher_claims%ROWTYPE;
  v_existing_voucher issued_vouchers%ROWTYPE;
  v_avail RECORD;
  v_code TEXT;v_expires TIMESTAMPTZ;v_snapshot JSONB;v_source TEXT;
  v_claim voucher_claims%ROWTYPE;v_voucher issued_vouchers%ROWTYPE;
  v_alloc_state TEXT;
  v_expected_canonical UUID;
  v_program_country TEXT;
  v_profile_country TEXT;
  v_username TEXT;
  -- eligibility re-evaluation
  v_ruleset voucher_eligibility_rule_sets%ROWTYPE;
  v_rule JSONB;
  v_rule_type TEXT;
  v_rule_satisfied BOOLEAN;
  v_all_satisfied BOOLEAN;
  v_any_satisfied BOOLEAN;
  v_requirements TEXT[];
  v_evidence JSONB;
  v_eligible BOOLEAN;
  v_days NUMERIC;
  v_account_created_at TIMESTAMPTZ;
  v_event_id UUID;
  v_eligibility_snapshot JSONB;
  -- claim_day_of_week
  v_claim_tz TEXT;
  v_claim_dow INTEGER;
BEGIN
  IF p_claim_mode NOT IN('self_claim','internal_grant','auto_award') THEN
    RAISE EXCEPTION 'INVALID_CLAIM_MODE' USING ERRCODE='P0001';END IF;
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE='P0001';END IF;
  IF p_canonical_id IS NULL THEN
    RAISE EXCEPTION 'CANONICAL_IDENTITY_REQUIRED' USING ERRCODE='P0001';END IF;
  IF p_hub_user_id IS NULL THEN
    RAISE EXCEPTION 'HUB_USER_ID_REQUIRED' USING ERRCODE='P0001';END IF;

  -- Direct operator grants use the same transactional authorization path as
  -- self-claims. Automated awards remain deliberately disabled until their
  -- trigger and actor contracts are implemented.
  IF p_claim_mode='auto_award' THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,NULL::UUID,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'CLAIM_MODE_NOT_ENABLED'::TEXT;RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('voucher-funding-claim:'||p_allocation_id::TEXT));
  SELECT * INTO v_alloc FROM voucher_funding_allocations WHERE id=p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ALLOCATION_NOT_FOUND' USING ERRCODE='P0001';END IF;
  SELECT * INTO v_program FROM voucher_funding_programs WHERE id=v_alloc.program_id;
  SELECT * INTO v_template FROM spend_voucher_templates WHERE id=v_alloc.voucher_template_id;

  -- ── Exact Hub/canonical identity pairing (fail closed) ────────────────────
  -- Resolved by p_hub_user_id (the JWT-authenticated identity), never by the
  -- caller-supplied p_canonical_id — a missing mapping and a mismatched one
  -- are both rejected. Every identity-keyed check from here on uses
  -- v_expected_canonical, not p_canonical_id.
  SELECT canonical_id INTO v_expected_canonical FROM hub_user_canonicals WHERE hub_user_id=p_hub_user_id;
  IF v_expected_canonical IS NULL THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'HUB_IDENTITY_LINK_REQUIRED'::TEXT;RETURN;
  END IF;
  IF v_expected_canonical<>p_canonical_id THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'HUB_USER_ID_MISMATCH'::TEXT;RETURN;
  END IF;

  -- Idempotent replay. voucher_claims has UNIQUE(allocation_id,idempotency_key)
  -- so this can match at most one row, but that row could belong to a
  -- different identity if two different callers independently produced the
  -- same key string — verify ownership before ever handing back claim data.
  SELECT * INTO v_existing_claim FROM voucher_claims vc
    WHERE vc.allocation_id=p_allocation_id AND vc.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing_claim.canonical_id<>v_expected_canonical
       OR v_existing_claim.hub_user_id IS DISTINCT FROM p_hub_user_id THEN
      RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
        NULL::TEXT,NULL::TIMESTAMPTZ,false,'IDEMPOTENCY_CONFLICT'::TEXT;RETURN;
    END IF;
    SELECT * INTO v_existing_voucher FROM issued_vouchers WHERE id=v_existing_claim.issued_voucher_id;
    RETURN QUERY SELECT true,v_existing_voucher.id,v_existing_claim.id,p_allocation_id,
      v_alloc.merchant_id,v_existing_voucher.status,v_existing_voucher.expires_at,true,''::TEXT;
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM voucher_claims vc WHERE vc.allocation_id=p_allocation_id AND vc.canonical_id=v_expected_canonical) THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'ALREADY_CLAIMED'::TEXT;RETURN;
  END IF;

  -- ── Country authorization — database state only ──────────────────────────
  v_program_country:=CASE WHEN v_program.country_code~'^[A-Z]{2}$' THEN v_program.country_code ELSE NULL END;
  IF v_program_country IS NULL THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'COUNTRY_POLICY_UNAVAILABLE'::TEXT;RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hub-profile-country:'||p_hub_user_id::TEXT));

  SELECT country_code INTO v_profile_country FROM hub_user_profiles WHERE user_id=p_hub_user_id;
  IF v_profile_country IS NULL OR v_profile_country!~'^[A-Z]{2}$' THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'COUNTRY_PROFILE_REQUIRED'::TEXT;RETURN;
  END IF;
  IF v_profile_country<>v_program_country THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'COUNTRY_NOT_ELIGIBLE'::TEXT;RETURN;
  END IF;

  -- ── Username authorization — resolved through the exact canonical id ─────
  SELECT username INTO v_username FROM leaderboard_profiles WHERE canonical_id=v_expected_canonical;
  IF v_username IS NULL THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'USERNAME_REQUIRED'::TEXT;RETURN;
  END IF;

  -- ── Member-wide advisory lock ─────────────────────────────────────────────
  -- first_funded_voucher and fund_claim_cooldown read across ALL of this
  -- member's claims, not just this allocation's — the allocation-level lock
  -- above only serializes concurrent claims on the SAME allocation. Taken
  -- unconditionally (cheap) rather than only when the rule set happens to
  -- contain one of those rule types, so adding such a rule later can never
  -- silently skip the lock.
  PERFORM pg_advisory_xact_lock(hashtext('voucher-funding-member:'||v_expected_canonical::TEXT));

  -- ── Eligibility — re-evaluated transactionally from persisted state ──────
  -- The allocation's actual eligibility_rule_set_id is loaded from the
  -- database; p_rule_set_id/p_rule_set_version and p_eligibility_snapshot/
  -- p_evidence_refs are accepted for call-signature compatibility only and
  -- are never read as authorization.
  v_eligibility_snapshot:=jsonb_build_object(
    'systemPolicy','funded_claim_eligibility_v1',
    'profileCountryCode',v_profile_country,
    'requiredCountryCode',v_program_country,
    'usernameAtClaim',v_username
  );
  v_evidence:='{}'::jsonb;

  IF v_alloc.eligibility_rule_set_id IS NOT NULL THEN
    SELECT * INTO v_ruleset FROM voucher_eligibility_rule_sets WHERE id=v_alloc.eligibility_rule_set_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
        NULL::TEXT,NULL::TIMESTAMPTZ,false,'ELIGIBILITY_POLICY_UNAVAILABLE'::TEXT;RETURN;
    END IF;

    v_all_satisfied:=true;
    v_any_satisfied:=false;
    v_requirements:=ARRAY[]::TEXT[];

    FOR v_rule IN SELECT * FROM jsonb_array_elements(v_ruleset.rules) LOOP
      v_rule_type:=v_rule->>'type';
      v_rule_satisfied:=false;

      CASE v_rule_type
        WHEN 'country_in' THEN
          v_rule_satisfied:=
            jsonb_array_length(COALESCE(v_rule->'countries','[]'::jsonb))=0
            OR v_profile_country=ANY(ARRAY(SELECT jsonb_array_elements_text(v_rule->'countries')));
        WHEN 'profile_country_set' THEN
          v_rule_satisfied:=v_profile_country IS NOT NULL;
        WHEN 'pass_activated' THEN
          v_rule_satisfied:=EXISTS(SELECT 1 FROM hub_user_passes WHERE user_id=p_hub_user_id);
        WHEN 'minimum_account_age_days' THEN
          v_days:=NULL;
          IF jsonb_typeof(v_rule->'days')='number' THEN v_days:=(v_rule->>'days')::NUMERIC; END IF;
          IF v_days IS NULL OR v_days<>floor(v_days) OR v_days<=0 OR v_days>3650 THEN
            -- Malformed/legacy/out-of-bounds configuration fails closed
            -- rather than silently becoming "no minimum" — never let a
            -- missing/zero days value satisfy this rule.
            v_rule_satisfied:=false;
          ELSE
            SELECT created_at INTO v_account_created_at FROM auth.users WHERE id=p_hub_user_id;
            v_rule_satisfied:=v_account_created_at IS NOT NULL
              AND now()>=v_account_created_at+make_interval(days=>v_days::int);
          END IF;
        WHEN 'verified_activity_completed' THEN
          v_event_id:=NULL;
          IF v_rule->>'templateKey' IS NOT NULL THEN
            SELECT id INTO v_event_id FROM events
              WHERE event_type=v_rule->>'templateKey' AND user_id=p_hub_user_id::TEXT
              ORDER BY created_at DESC LIMIT 1;
          END IF;
          v_rule_satisfied:=v_event_id IS NOT NULL;
          IF v_rule_satisfied THEN
            v_evidence:=v_evidence||jsonb_build_object('verified_activity_completed',v_event_id);
          END IF;
        WHEN 'first_funded_voucher' THEN
          v_rule_satisfied:=NOT EXISTS(SELECT 1 FROM voucher_claims WHERE canonical_id=v_expected_canonical);
        WHEN 'no_prior_merchant_redemption' THEN
          -- vr. qualification is load-bearing, not style. This function's
          -- RETURNS TABLE declares an output column named merchant_id, and a
          -- RETURNS TABLE column is an implicit variable in scope for the
          -- whole body — so the unqualified `merchant_id=` this rule carried
          -- until now raised "column reference merchant_id is ambiguous"
          -- (SQLSTATE 42702) on every claim against an allocation using it.
          -- Platform 126 fixed exactly this class of bug by renaming the
          -- allocation_id output to out_allocation_id; merchant_id kept its
          -- name and this one reference was missed, so the rule has never
          -- successfully evaluated in production. Any new table reference in
          -- this function must be aliased for the same reason.
          v_rule_satisfied:=NOT EXISTS(
            SELECT 1 FROM voucher_redemptions vr
            WHERE vr.merchant_id=v_alloc.merchant_id AND vr.hub_user_id=p_hub_user_id
          );
        WHEN 'fund_claim_cooldown' THEN
          v_days:=NULL;
          IF jsonb_typeof(v_rule->'days')='number' THEN v_days:=(v_rule->>'days')::NUMERIC; END IF;
          IF v_days IS NULL OR v_days<>floor(v_days) OR v_days<=0 OR v_days>365 THEN
            v_rule_satisfied:=false;
          ELSE
            v_rule_satisfied:=NOT EXISTS(
              SELECT 1 FROM voucher_claims
              WHERE canonical_id=v_expected_canonical
                AND claimed_at>=now()-make_interval(days=>v_days::int)
            );
          END IF;
        WHEN 'claim_day_of_week' THEN
          -- {"type":"claim_day_of_week","days":[6,0],"timezone":"Africa/Nairobi"}
          -- days uses EXTRACT(DOW) numbering: 0=Sunday … 6=Saturday, the same
          -- convention as merchant_default_offers.days_of_week, so a weekend
          -- offer is [6,0] in both places.
          v_rule_satisfied:=false;
          v_claim_tz:=COALESCE(NULLIF(btrim(v_rule->>'timezone'),''),'Africa/Nairobi');
          -- An unrecognised zone would make AT TIME ZONE raise, which would
          -- abort the whole claim transaction instead of failing this one
          -- rule closed. Check the catalog first so a bad config denies the
          -- claim cleanly and the member sees the normal requirements error.
          IF EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_claim_tz)
             AND jsonb_typeof(v_rule->'days')='array'
             AND jsonb_array_length(v_rule->'days')>0
             AND NOT EXISTS(
               SELECT 1 FROM jsonb_array_elements(v_rule->'days') AS day_entry(value)
               WHERE jsonb_typeof(day_entry.value) IS DISTINCT FROM 'number'
                  OR (day_entry.value#>>'{}')::NUMERIC<>floor((day_entry.value#>>'{}')::NUMERIC)
                  OR (day_entry.value#>>'{}')::NUMERIC<0
                  OR (day_entry.value#>>'{}')::NUMERIC>6
             ) THEN
            v_claim_dow:=EXTRACT(DOW FROM (now() AT TIME ZONE v_claim_tz))::INTEGER;
            v_rule_satisfied:=EXISTS(
              SELECT 1 FROM jsonb_array_elements(v_rule->'days') AS day_entry(value)
              WHERE (day_entry.value#>>'{}')::NUMERIC=v_claim_dow
            );
          END IF;
        WHEN 'not_blocked' THEN
          -- No restriction source exists yet — never silently pass.
          v_rule_satisfied:=false;
        ELSE
          -- Unknown rule type fails closed.
          v_rule_satisfied:=false;
      END CASE;

      IF v_rule_satisfied THEN
        v_any_satisfied:=true;
      ELSE
        v_all_satisfied:=false;
        v_requirements:=array_append(v_requirements,COALESCE(v_rule_type,'unknown'));
      END IF;
    END LOOP;

    v_eligible:=CASE WHEN v_ruleset.mode='any' THEN v_any_satisfied ELSE v_all_satisfied END;

    IF NOT v_eligible THEN
      RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
        NULL::TEXT,NULL::TIMESTAMPTZ,false,'ELIGIBILITY_REQUIREMENTS_NOT_MET'::TEXT;RETURN;
    END IF;

    v_eligibility_snapshot:=v_eligibility_snapshot||jsonb_build_object(
      'ruleSetId',v_ruleset.id,'ruleSetVersion',v_ruleset.version,'mode',v_ruleset.mode,
      -- Non-empty in 'any' mode is expected and correct: the member can pass
      -- via one satisfied rule while other configured rules on the same
      -- allocation remain unsatisfied for them — this is audit information,
      -- not a contradiction of v_eligible already having gated the claim.
      'requirementsRemaining',to_jsonb(v_requirements)
    );
  END IF;

  IF NOT(p_claim_mode=ANY(v_alloc.distribution_modes)) THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'DISTRIBUTION_MODE_NOT_SUPPORTED'::TEXT;RETURN;
  END IF;

  v_alloc_state:=v_alloc.state;
  IF v_alloc_state='scheduled' AND v_alloc.claim_starts_at<=now() THEN v_alloc_state:='active';END IF;
  IF v_alloc_state<>'active' OR now()<v_alloc.claim_starts_at OR now()>=v_alloc.claim_ends_at THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'ALLOCATION_NOT_CLAIMABLE'::TEXT;RETURN;
  END IF;
  IF v_program.state NOT IN('active','scheduled') OR now()<v_program.starts_at OR now()>=v_program.ends_at THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'PROGRAM_NOT_LIVE'::TEXT;RETURN;
  END IF;

  SELECT status INTO v_partner FROM partners WHERE id=v_alloc.merchant_id;
  IF v_partner.status IS DISTINCT FROM 'active' THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'MERCHANT_NOT_ELIGIBLE'::TEXT;RETURN;
  END IF;

  SELECT * INTO v_avail FROM v_voucher_funding_allocation_availability av WHERE av.allocation_id=p_allocation_id;
  IF COALESCE(v_avail.quantity_remaining,0)<=0 THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'QUANTITY_EXHAUSTED'::TEXT;RETURN;
  END IF;
  IF COALESCE(v_avail.available_budget_minor,0)<v_alloc.max_reimbursement_minor THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'BUDGET_EXHAUSTED'::TEXT;RETURN;
  END IF;

  IF v_alloc_state<>v_alloc.state THEN
    UPDATE voucher_funding_allocations SET state=v_alloc_state,updated_at=now() WHERE id=p_allocation_id;
  END IF;

  v_code:='AKB-'||upper(substr(md5(random()::TEXT||clock_timestamp()::TEXT),1,10));
  v_expires:=now()+make_interval(secs=>v_alloc.voucher_validity_seconds);
  v_source:=CASE p_claim_mode
    WHEN 'self_claim' THEN 'akiba_funded_claim'
    WHEN 'internal_grant' THEN 'akiba_funded_grant'
    ELSE 'akiba_funded_auto_award' END;
  -- discount_percent/maximum_discount_kes are what redeem_kes_voucher_and_
  -- award_atomic reads for a percent_off benefit; it RAISEs
  -- INVALID_PERCENT_VOUCHER_SNAPSHOT if either is missing. They are written
  -- unconditionally (NULL for a fixed_off benefit, which that function does
  -- not read) so the snapshot shape stays the same for every funded voucher.
  v_snapshot:=jsonb_build_object(
    'version','akiba_funded_voucher_v1','title',v_template.title,
    'voucher_type',v_template.voucher_type,'discount_kes',v_template.discount_kes,
    'discount_percent',v_template.discount_percent,
    'maximum_discount_kes',v_template.maximum_discount_kes,
    'minimum_spend_kes',v_template.minimum_spend_kes,'terms_text',v_template.terms_text,
    'fundingAllocationId',p_allocation_id,'fundingProgramId',v_alloc.program_id
  );

  -- A percent benefit whose cap never made it onto the template would claim
  -- here and then fail at the counter with INVALID_PERCENT_VOUCHER_SNAPSHOT,
  -- leaving the member holding a voucher no till can honour. Refuse the claim
  -- instead, so the reservation is never taken and the fault stays visible as
  -- a configuration error on the allocation.
  IF v_template.voucher_type='percent_off'
     AND (v_template.discount_percent IS NULL OR v_template.maximum_discount_kes IS NULL) THEN
    RETURN QUERY SELECT false,NULL::UUID,NULL::UUID,p_allocation_id,v_alloc.merchant_id,
      NULL::TEXT,NULL::TIMESTAMPTZ,false,'BENEFIT_CONFIGURATION_INVALID'::TEXT;RETURN;
  END IF;

  INSERT INTO issued_vouchers(
    user_address,hub_user_id,merchant_id,voucher_template_id,acquisition_source,source_ref,
    funding_type,code,status,idempotency_key,rules_snapshot,expires_at,
    canonical_id,funding_allocation_id,funding_mode,
    discount_currency,max_reimbursement_minor,managed_by,username_at_claim
  ) VALUES(
    NULL,p_hub_user_id,v_alloc.merchant_id,v_alloc.voucher_template_id,v_source,
    p_idempotency_key,'akiba_reimbursement',v_code,'issued',p_allocation_id::TEXT||':'||p_idempotency_key,
    v_snapshot,v_expires,v_expected_canonical,p_allocation_id,'akiba_reimbursement',
    'KES',v_alloc.max_reimbursement_minor,'akiba',v_username
  ) RETURNING * INTO v_voucher;

  INSERT INTO voucher_claims(
    allocation_id,canonical_id,hub_user_id,issued_voucher_id,claim_mode,idempotency_key,rule_set_id,rule_set_version,
    eligibility_snapshot,evidence_refs,country_code,country_assurance,reservation_minor,username_at_claim
  ) VALUES(
    p_allocation_id,v_expected_canonical,p_hub_user_id,v_voucher.id,p_claim_mode,p_idempotency_key,
    v_alloc.eligibility_rule_set_id,v_ruleset.version,
    v_eligibility_snapshot,v_evidence,v_profile_country,'self_declared_profile',v_alloc.max_reimbursement_minor,v_username
  ) RETURNING * INTO v_claim;

  UPDATE issued_vouchers SET voucher_claim_id=v_claim.id WHERE id=v_voucher.id;

  INSERT INTO voucher_funding_ledger_entries(
    program_id,allocation_id,issued_voucher_id,entry_type,amount_minor,idempotency_key,
    actor_type,actor_id,metadata
  ) VALUES(
    v_alloc.program_id,p_allocation_id,v_voucher.id,'reservation_created',
    v_alloc.max_reimbursement_minor,'reservation_created:'||v_claim.id::TEXT,
    p_actor_type,p_actor_id,jsonb_build_object('claimId',v_claim.id)
  );

  SELECT * INTO v_avail FROM v_voucher_funding_allocation_availability av WHERE av.allocation_id=p_allocation_id;
  IF (COALESCE(v_avail.quantity_remaining,0)<=0
      OR COALESCE(v_avail.available_budget_minor,0)<v_alloc.max_reimbursement_minor) THEN
    UPDATE voucher_funding_allocations SET state='exhausted',version=version+1,updated_at=now()
      WHERE id=p_allocation_id AND state IN('active','scheduled');
    INSERT INTO audit_logs(actor_type,entity_type,entity_id,action)
    VALUES('system','voucher_funding_allocation',p_allocation_id,'allocation.exhausted');
  END IF;

  INSERT INTO audit_logs(actor_id,actor_type,entity_type,entity_id,action,after,metadata)
  VALUES(
    CASE WHEN p_actor_type IN('internal_user','member') THEN p_actor_id::UUID ELSE NULL END,
    p_actor_type,'voucher_claim',v_claim.id,'claim.succeeded',to_jsonb(v_claim),
    jsonb_build_object('issuedVoucherId',v_voucher.id)
  );

  RETURN QUERY SELECT true,v_voucher.id,v_claim.id,p_allocation_id,v_alloc.merchant_id,
    v_voucher.status,v_voucher.expires_at,false,''::TEXT;
END; $$;
REVOKE ALL ON FUNCTION claim_akiba_funded_voucher_atomic(
  UUID,UUID,TEXT,TEXT,UUID,TEXT,UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_akiba_funded_voucher_atomic(
  UUID,UUID,TEXT,TEXT,UUID,TEXT,UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT
) TO service_role;

COMMENT ON FUNCTION claim_akiba_funded_voucher_atomic(
  UUID,UUID,TEXT,TEXT,UUID,TEXT,UUID,INTEGER,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT
) IS 'Percent benefits and weekend claims (110): self_claim and internal_grant enabled; auto_award remains disabled. The rules snapshot carries discount_percent and maximum_discount_kes so redeem_kes_voucher_and_award_atomic can compute a percent_off benefit at the till, and a percent_off template missing either field is refused at claim time with BENEFIT_CONFIGURATION_INVALID rather than issuing a voucher no till can honour. The claim_day_of_week rule gates claims on the local calendar day (EXTRACT(DOW) numbering, default Africa/Nairobi) and fails closed on a malformed day list or unrecognised timezone. Canonical identity is resolved from hub_user_canonicals by p_hub_user_id and must equal p_canonical_id exactly (fails closed on missing or mismatched mapping). Country, username, and every configured eligibility rule are re-evaluated here from persisted database state — p_country_code, p_country_assurance, p_eligibility_snapshot, p_evidence_refs, p_rule_set_id, and p_rule_set_version are accepted for call-signature compatibility only and are never trusted as authorization. user_address is always stored NULL.';


-- ══════════════════════════════════════════════════════════════════════════════
-- Eligibility rule vocabulary — the other two definitions
-- ══════════════════════════════════════════════════════════════════════════════
-- claim_day_of_week has to be taught to all three places that know the rule
-- vocabulary, or it fails closed in a way that looks like a bug:
--
--   1. claim_akiba_funded_voucher_atomic (above) — evaluates the rule.
--   2. validate_funded_voucher_rule_set_row — allow-lists rule types on
--      INSERT into voucher_eligibility_rule_sets. Without it, the rule set
--      cannot even be created: UNSUPPORTED_ELIGIBILITY_RULE_TYPE.
--   3. enforce_funded_voucher_claim_eligibility_audit — re-evaluates every
--      rule on INSERT into voucher_claims as defence in depth, and its ELSE
--      branch treats an unrecognised type as unavailable policy. Without it,
--      every claim against an allocation carrying the rule would be rejected
--      with ELIGIBILITY_POLICY_UNAVAILABLE *after* the RPC had allowed it.
--
-- Both trigger functions originate in Akiba-Platform 149 and are carried
-- forward here, unchanged apart from the new rule, so that all three
-- definitions of the vocabulary live in one file from now on. Splitting them
-- across repositories is what made (3) easy to miss. See docs/BDR-005.
CREATE OR REPLACE FUNCTION validate_funded_voucher_rule_set_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule jsonb;
  v_type text;
  v_days numeric;
  v_allowed text[] := ARRAY[
    'country_in','pass_activated','profile_country_set','minimum_account_age_days',
    'verified_activity_completed','first_funded_voucher','no_prior_merchant_redemption',
    'fund_claim_cooldown','claim_day_of_week'
  ];
BEGIN
  IF NEW.mode NOT IN ('all','any')
     OR NEW.rules IS NULL
     OR jsonb_typeof(NEW.rules) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ELIGIBILITY_POLICY_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(NEW.rules) = 0 THEN
    RAISE EXCEPTION 'ELIGIBILITY_POLICY_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(NEW.rules) LOOP
    v_type := v_rule->>'type';
    IF jsonb_typeof(v_rule) <> 'object'
       OR v_type IS NULL
       OR NOT (v_type = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'UNSUPPORTED_ELIGIBILITY_RULE_TYPE' USING ERRCODE = 'P0001';
    END IF;

    IF v_type = 'country_in' THEN
      IF jsonb_typeof(v_rule->'countries') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'INVALID_COUNTRY_IN_COUNTRIES' USING ERRCODE = 'P0001';
      ELSIF jsonb_array_length(v_rule->'countries') = 0 THEN
        RAISE EXCEPTION 'INVALID_COUNTRY_IN_COUNTRIES' USING ERRCODE = 'P0001';
      ELSIF EXISTS (
           SELECT 1
           FROM jsonb_array_elements(v_rule->'countries') AS country_entry(value)
           WHERE jsonb_typeof(country_entry.value) IS DISTINCT FROM 'string'
              OR (country_entry.value #>> '{}') !~ '^[A-Z]{2}$'
      ) THEN
        RAISE EXCEPTION 'INVALID_COUNTRY_IN_COUNTRIES' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_type = 'verified_activity_completed' THEN
      IF NULLIF(btrim(v_rule->>'templateKey'), '') IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM verification_templates
           WHERE template_key = v_rule->>'templateKey' AND status = 'active'
         ) THEN
        RAISE EXCEPTION 'VERIFIED_ACTIVITY_TEMPLATE_NOT_AVAILABLE' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_type = 'minimum_account_age_days' THEN
      IF jsonb_typeof(v_rule->'days') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'INVALID_MINIMUM_ACCOUNT_AGE_DAYS' USING ERRCODE = 'P0001';
      END IF;
      v_days := (v_rule->>'days')::numeric;
      IF v_days <> floor(v_days) OR v_days <= 0 OR v_days > 3650 THEN
        RAISE EXCEPTION 'INVALID_MINIMUM_ACCOUNT_AGE_DAYS' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_type = 'fund_claim_cooldown' THEN
      IF jsonb_typeof(v_rule->'days') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'INVALID_FUND_CLAIM_COOLDOWN_DAYS' USING ERRCODE = 'P0001';
      END IF;
      v_days := (v_rule->>'days')::numeric;
      IF v_days <> floor(v_days) OR v_days <= 0 OR v_days > 365 THEN
        RAISE EXCEPTION 'INVALID_FUND_CLAIM_COOLDOWN_DAYS' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_type = 'claim_day_of_week' THEN
      -- Rejected at authoring time rather than silently denying every claim
      -- later: the evaluating paths fail this rule closed, so a typo here
      -- would otherwise read as "nobody is eligible, ever".
      IF jsonb_typeof(v_rule->'days') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_rule->'days') = 0
         OR jsonb_array_length(v_rule->'days') > 7
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(v_rule->'days') AS day_entry(value)
           WHERE jsonb_typeof(day_entry.value) IS DISTINCT FROM 'number'
              OR (day_entry.value #>> '{}')::numeric <> floor((day_entry.value #>> '{}')::numeric)
              OR (day_entry.value #>> '{}')::numeric < 0
              OR (day_entry.value #>> '{}')::numeric > 6
         ) THEN
        RAISE EXCEPTION 'INVALID_CLAIM_DAY_OF_WEEK_DAYS' USING ERRCODE = 'P0001';
      END IF;
      IF v_rule ? 'timezone'
         AND NOT EXISTS (
           SELECT 1 FROM pg_timezone_names
           WHERE name = NULLIF(btrim(v_rule->>'timezone'), '')
         ) THEN
        RAISE EXCEPTION 'INVALID_CLAIM_DAY_OF_WEEK_TIMEZONE' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_funded_voucher_rule_set_row
  ON voucher_eligibility_rule_sets;
CREATE TRIGGER trg_validate_funded_voucher_rule_set_row
  BEFORE INSERT ON voucher_eligibility_rule_sets
  FOR EACH ROW EXECUTE FUNCTION validate_funded_voucher_rule_set_row();

CREATE OR REPLACE FUNCTION enforce_funded_voucher_claim_eligibility_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc voucher_funding_allocations%ROWTYPE;
  v_ruleset voucher_eligibility_rule_sets%ROWTYPE;
  v_rule jsonb;
  v_type text;
  v_index integer := 0;
  v_satisfied boolean;
  v_policy_invalid boolean := false;
  v_all_satisfied boolean := true;
  v_any_satisfied boolean := false;
  v_days numeric;
  v_created_at timestamptz;
  v_verification_id uuid;
  v_rule_evidence jsonb;
  v_results jsonb := '[]'::jsonb;
  v_evidence jsonb := '{}'::jsonb;
  v_requirements text[] := ARRAY[]::text[];
  v_evaluated_at timestamptz := clock_timestamp();
  v_claim_tz text;
  v_claim_dow integer;
BEGIN
  SELECT * INTO v_alloc
  FROM voucher_funding_allocations
  WHERE id = NEW.allocation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ELIGIBILITY_POLICY_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_alloc.eligibility_rule_set_id IS NULL THEN
    NEW.eligibility_snapshot := COALESCE(NEW.eligibility_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'evaluatedAt', v_evaluated_at,
        'eligible', true,
        'ruleResults', '[]'::jsonb,
        'requirementsRemaining', '[]'::jsonb
      );
    NEW.evidence_refs := '{}'::jsonb;
    RETURN NEW;
  END IF;

  SELECT * INTO v_ruleset
  FROM voucher_eligibility_rule_sets
  WHERE id = v_alloc.eligibility_rule_set_id;

  IF NOT FOUND
     OR v_ruleset.mode NOT IN ('all','any')
     OR jsonb_typeof(v_ruleset.rules) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ELIGIBILITY_POLICY_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_ruleset.rules) = 0 THEN
    RAISE EXCEPTION 'ELIGIBILITY_POLICY_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(v_ruleset.rules) LOOP
    v_index := v_index + 1;
    v_type := v_rule->>'type';
    v_satisfied := false;
    v_rule_evidence := NULL;

    CASE v_type
      WHEN 'country_in' THEN
        IF jsonb_typeof(v_rule->'countries') IS DISTINCT FROM 'array' THEN
          v_policy_invalid := true;
        ELSIF jsonb_array_length(v_rule->'countries') = 0 THEN
          v_policy_invalid := true;
        ELSIF EXISTS (
             SELECT 1
             FROM jsonb_array_elements(v_rule->'countries') AS country_entry(value)
             WHERE jsonb_typeof(country_entry.value) IS DISTINCT FROM 'string'
                OR (country_entry.value #>> '{}') !~ '^[A-Z]{2}$'
        ) THEN
          v_policy_invalid := true;
        ELSE
          v_satisfied := NEW.country_code = ANY(
            ARRAY(SELECT jsonb_array_elements_text(v_rule->'countries'))
          );
        END IF;
      WHEN 'profile_country_set' THEN
        v_satisfied := NEW.country_code IS NOT NULL AND NEW.country_code ~ '^[A-Z]{2}$';
      WHEN 'pass_activated' THEN
        v_satisfied := NEW.hub_user_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM hub_user_passes WHERE user_id = NEW.hub_user_id
        );
      WHEN 'minimum_account_age_days' THEN
        IF jsonb_typeof(v_rule->'days') IS DISTINCT FROM 'number' THEN
          v_policy_invalid := true;
        ELSE
          v_days := (v_rule->>'days')::numeric;
          IF v_days <> floor(v_days) OR v_days <= 0 OR v_days > 3650 THEN
            v_policy_invalid := true;
          ELSE
            SELECT created_at INTO v_created_at FROM auth.users WHERE id = NEW.hub_user_id;
            v_satisfied := v_created_at IS NOT NULL
              AND now() >= v_created_at + make_interval(days => v_days::integer);
          END IF;
        END IF;
      WHEN 'verified_activity_completed' THEN
        IF NULLIF(btrim(v_rule->>'templateKey'), '') IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM verification_templates
             WHERE template_key = v_rule->>'templateKey' AND status = 'active'
           ) THEN
          v_policy_invalid := true;
        ELSE
          SELECT verification.id INTO v_verification_id
          FROM verifications verification
          WHERE verification.template_key = v_rule->>'templateKey'
            AND verification.user_id = NEW.hub_user_id
            AND verification.status = 'verified'
            AND verification.verified_at IS NOT NULL
          ORDER BY verification.verified_at DESC, verification.created_at DESC
          LIMIT 1;
          v_satisfied := v_verification_id IS NOT NULL;
          IF v_satisfied THEN
            v_rule_evidence := jsonb_build_object(
              'kind', 'verification',
              'id', v_verification_id,
              'templateKey', v_rule->>'templateKey'
            );
          END IF;
        END IF;
      WHEN 'first_funded_voucher' THEN
        v_satisfied := NOT EXISTS (
          SELECT 1 FROM voucher_claims WHERE canonical_id = NEW.canonical_id
        );
      WHEN 'no_prior_merchant_redemption' THEN
        v_satisfied := NOT EXISTS (
          SELECT 1 FROM voucher_redemptions
          WHERE merchant_id = v_alloc.merchant_id AND hub_user_id = NEW.hub_user_id
        );
      WHEN 'fund_claim_cooldown' THEN
        IF jsonb_typeof(v_rule->'days') IS DISTINCT FROM 'number' THEN
          v_policy_invalid := true;
        ELSE
          v_days := (v_rule->>'days')::numeric;
          IF v_days <> floor(v_days) OR v_days <= 0 OR v_days > 365 THEN
            v_policy_invalid := true;
          ELSE
            v_satisfied := NOT EXISTS (
              SELECT 1 FROM voucher_claims
              WHERE canonical_id = NEW.canonical_id
                AND claimed_at >= now() - make_interval(days => v_days::integer)
            );
          END IF;
        END IF;
      WHEN 'claim_day_of_week' THEN
        -- Re-evaluated against the clock at insert time, in the same
        -- transaction as the RPC's own check, so a claim cannot straddle
        -- midnight between the two evaluations and land on an excluded day.
        v_claim_tz := COALESCE(NULLIF(btrim(v_rule->>'timezone'), ''), 'Africa/Nairobi');
        IF jsonb_typeof(v_rule->'days') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_rule->'days') = 0
           OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(v_rule->'days') AS day_entry(value)
             WHERE jsonb_typeof(day_entry.value) IS DISTINCT FROM 'number'
                OR (day_entry.value #>> '{}')::numeric <> floor((day_entry.value #>> '{}')::numeric)
                OR (day_entry.value #>> '{}')::numeric < 0
                OR (day_entry.value #>> '{}')::numeric > 6
           )
           OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_claim_tz) THEN
          v_policy_invalid := true;
        ELSE
          v_claim_dow := EXTRACT(DOW FROM (now() AT TIME ZONE v_claim_tz))::integer;
          v_satisfied := EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_rule->'days') AS day_entry(value)
            WHERE (day_entry.value #>> '{}')::numeric = v_claim_dow
          );
          v_rule_evidence := jsonb_build_object(
            'kind', 'claim_day_of_week',
            'timezone', v_claim_tz,
            'dayOfWeek', v_claim_dow
          );
        END IF;
      ELSE
        -- Includes historical not_blocked rules. There is no trustworthy
        -- restriction source yet, so an `any` sibling may not mask it.
        v_policy_invalid := true;
    END CASE;

    v_all_satisfied := v_all_satisfied AND v_satisfied;
    v_any_satisfied := v_any_satisfied OR v_satisfied;
    IF NOT v_satisfied THEN
      v_requirements := array_append(v_requirements, COALESCE(v_type, 'unknown'));
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'index', v_index,
      'type', COALESCE(v_type, 'unknown'),
      'satisfied', v_satisfied,
      'evidence', v_rule_evidence
    )));
    IF v_rule_evidence IS NOT NULL THEN
      v_evidence := v_evidence || jsonb_build_object('rule:' || v_index::text, v_rule_evidence);
    END IF;
  END LOOP;

  IF v_policy_invalid THEN
    RAISE EXCEPTION 'ELIGIBILITY_POLICY_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF (v_ruleset.mode = 'all' AND NOT v_all_satisfied)
     OR (v_ruleset.mode = 'any' AND NOT v_any_satisfied) THEN
    RAISE EXCEPTION 'ELIGIBILITY_REQUIREMENTS_NOT_MET' USING ERRCODE = 'P0001';
  END IF;

  NEW.rule_set_id := v_ruleset.id;
  NEW.rule_set_version := v_ruleset.version;
  NEW.eligibility_snapshot := COALESCE(NEW.eligibility_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'evaluatedAt', v_evaluated_at,
      'eligible', true,
      'ruleResults', v_results,
      'requirementsRemaining', to_jsonb(v_requirements)
    );
  NEW.evidence_refs := v_evidence;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_funded_voucher_claim_eligibility_audit
  ON voucher_claims;
CREATE TRIGGER trg_enforce_funded_voucher_claim_eligibility_audit
  BEFORE INSERT ON voucher_claims
  FOR EACH ROW EXECUTE FUNCTION enforce_funded_voucher_claim_eligibility_audit();

REVOKE ALL ON FUNCTION validate_funded_voucher_rule_set_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enforce_funded_voucher_claim_eligibility_audit() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION validate_funded_voucher_rule_set_row() IS
  'Authoring-time allow-list for funded-voucher eligibility rule types (110). This list and the CASE blocks in claim_akiba_funded_voucher_atomic and enforce_funded_voucher_claim_eligibility_audit are one vocabulary: a rule type added to any one of the three without the other two either cannot be authored or fails every claim closed.';

COMMENT ON FUNCTION enforce_funded_voucher_claim_eligibility_audit() IS
  'Final funded-voucher claim boundary: re-evaluates the persisted rule set, rejects malformed/unavailable policy even in any mode, requires successful registered verification records, re-checks claim_day_of_week against the clock inside the claim transaction, and stores per-rule timestamped audit results.';
