-- 098_enable_admin_internal_voucher_grants.sql
--
-- Enables permissioned Admin Dashboard direct issuance without an environment
-- feature gate. This is a forward-only replacement for the Platform phase-one
-- claim function: internal_grant now runs through the same database-resolved
-- identity, country, eligibility, allocation, quantity, budget, reservation,
-- idempotency, ledger, and audit controls as self_claim. auto_award remains
-- explicitly disabled until its trigger and actor contracts are implemented.
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
          v_rule_satisfied:=NOT EXISTS(
            SELECT 1 FROM voucher_redemptions WHERE merchant_id=v_alloc.merchant_id AND hub_user_id=p_hub_user_id
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
  v_snapshot:=jsonb_build_object(
    'version','akiba_funded_voucher_v1','title',v_template.title,
    'voucher_type',v_template.voucher_type,'discount_kes',v_template.discount_kes,
    'minimum_spend_kes',v_template.minimum_spend_kes,'terms_text',v_template.terms_text,
    'fundingAllocationId',p_allocation_id,'fundingProgramId',v_alloc.program_id
  );

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
) IS 'Admin direct-grant activation (098): self_claim and internal_grant enabled; auto_award remains disabled. Canonical identity is resolved from hub_user_canonicals by p_hub_user_id and must equal p_canonical_id exactly (fails closed on missing or mismatched mapping). Country, username, and every configured eligibility rule are re-evaluated here from persisted database state — p_country_code, p_country_assurance, p_eligibility_snapshot, p_evidence_refs, p_rule_set_id, and p_rule_set_version are accepted for call-signature compatibility only and are never trusted as authorization. user_address is always stored NULL.';

