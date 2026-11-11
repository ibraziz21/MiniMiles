-- 126_welcome_offer_enrolment.sql
--
-- The new-member welcome offer (docs/BDR-008): 25% off, capped at KSh 250,
-- one use within 7 days, for the first 1,000 new members, issued
-- automatically — the member never claims it.
--
-- APPLY AFTER 113 (and Akiba-Platform 154/155). It reuses the funded-voucher
-- engine whole: the offer is an ordinary Akiba-funded allocation whose
-- eligible merchant set, budget reservation, claim snapshot, QR redemption
-- and merchant reimbursement all work exactly as for any other funded
-- voucher. What this migration adds:
--
--   1. welcome_offer_campaigns — which allocation is the welcome offer, the
--      enrolment cap and window, and its state. The campaign row is the
--      on/off switch: nothing is issued unless one is `enrolling`.
--   2. welcome_offer_enrolments — one per canonical member, ever. Unique on
--      canonical_id, so reinstalling, signing in again or linking another
--      sign-in method cannot earn a second voucher.
--   3. enrol_welcome_offer — checks the campaign and the member, issues the
--      voucher through claim_akiba_funded_voucher_atomic in auto_award mode,
--      and records the enrolment, all in one transaction. A failure leaves
--      no enrolment, no voucher and no reservation.
--   4. claim_akiba_funded_voucher_atomic carried forward from 113 with one
--      change: auto_award is allowed for the welcome campaign's allocation,
--      only from inside enrol_welcome_offer (BDR-008 §3.4).
--
-- SETTING UP A CAMPAIGN (operator, once):
--   a. Author the allocation with create_voucher_funding_allocation_atomic:
--      percent_off 25, maximum_discount_kes 250, minimum_spend_kes 1000
--      (BDR-008 §6.2 — the engine requires a minimum above the cap),
--      voucher_validity_seconds 604800, quantity_cap 1000,
--      p_distribution_modes => ARRAY['auto_award'] (not self_claim, so it
--      never appears as a claimable offer), and the ready merchants as its
--      eligible set. Approve and activate it as usual.
--   b. INSERT INTO welcome_offer_campaigns (key, allocation_id, enrolment_cap,
--      enrolment_starts_at, state) VALUES (..., 1000, now(), 'enrolling');
--   Raising the cap later = raise the allocation's quantity/budget and the
--   campaign's enrolment_cap together.
--
-- "New member" (BDR-008 §4): the Auth account was created on or after the
-- campaign's enrolment_starts_at. The native-app-only rule is enforced by the
-- caller (hub-page only enrols for bearer-token requests), because the
-- database cannot see which client made a request.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Campaigns
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS welcome_offer_campaigns (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text        NOT NULL UNIQUE,
  allocation_id       uuid        NOT NULL UNIQUE REFERENCES voucher_funding_allocations(id),
  state               text        NOT NULL DEFAULT 'draft'
                        CHECK (state IN ('draft', 'enrolling', 'paused', 'closed')),
  enrolment_cap       integer     NOT NULL CHECK (enrolment_cap > 0),
  enrolment_starts_at timestamptz NOT NULL,
  enrolment_ends_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (enrolment_ends_at IS NULL OR enrolment_ends_at > enrolment_starts_at)
);

-- One campaign enrols at a time, so "which offer does a new member get"
-- always has one answer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_welcome_offer_campaigns_enrolling
  ON welcome_offer_campaigns ((true)) WHERE state = 'enrolling';

-- A campaign may only point at an allocation the welcome flow can actually
-- issue and the till can actually honour; caught when the row is written
-- rather than as a silent failure for every new member.
CREATE OR REPLACE FUNCTION validate_welcome_offer_campaign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc    voucher_funding_allocations%ROWTYPE;
  v_template spend_voucher_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_alloc FROM voucher_funding_allocations WHERE id = NEW.allocation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WELCOME_ALLOCATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT ('auto_award' = ANY(v_alloc.distribution_modes)) THEN
    RAISE EXCEPTION 'WELCOME_ALLOCATION_NOT_AUTO_AWARD' USING ERRCODE = 'P0001';
  END IF;
  -- A self-claimable welcome allocation would show up as an ordinary offer
  -- anyone could claim, outside the new-member rule and the enrolment cap.
  IF 'self_claim' = ANY(v_alloc.distribution_modes) THEN
    RAISE EXCEPTION 'WELCOME_ALLOCATION_SELF_CLAIMABLE' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_template FROM spend_voucher_templates WHERE id = v_alloc.voucher_template_id;
  IF v_template.voucher_type IS DISTINCT FROM 'percent_off'
     OR v_template.discount_percent IS NULL
     OR v_template.maximum_discount_kes IS NULL THEN
    RAISE EXCEPTION 'WELCOME_ALLOCATION_BENEFIT_INVALID' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_welcome_offer_campaign ON welcome_offer_campaigns;
CREATE TRIGGER trg_validate_welcome_offer_campaign
  BEFORE INSERT OR UPDATE ON welcome_offer_campaigns
  FOR EACH ROW EXECUTE FUNCTION validate_welcome_offer_campaign();

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Enrolments
-- ══════════════════════════════════════════════════════════════════════════════
-- canonical_id is kept if the member's account is deleted (hub_user_id is
-- nulled): it is what stops the same person earning the offer again, and it
-- sits beside the voucher_claims row the funding ledger already keeps.
CREATE TABLE IF NOT EXISTS welcome_offer_enrolments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid        NOT NULL REFERENCES welcome_offer_campaigns(id),
  canonical_id      uuid        NOT NULL UNIQUE,
  hub_user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_voucher_id uuid        UNIQUE REFERENCES issued_vouchers(id) ON DELETE SET NULL,
  voucher_claim_id  uuid,
  enrolled_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_welcome_offer_enrolments_campaign
  ON welcome_offer_enrolments (campaign_id);

ALTER TABLE welcome_offer_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE welcome_offer_enrolments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON welcome_offer_campaigns, welcome_offer_enrolments FROM PUBLIC, anon, authenticated;
GRANT ALL ON welcome_offer_campaigns, welcome_offer_enrolments TO service_role;
REVOKE ALL ON FUNCTION validate_welcome_offer_campaign() FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. The claim RPC, carried forward from 113
-- ══════════════════════════════════════════════════════════════════════════════
-- Byte-for-byte 113 apart from the auto_award gate near the top and the
-- COMMENT. Reproduced from 113, the newest definition, never an older copy
-- (BDR-005).

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
  -- self-claims. Automated awards are enabled for exactly one caller
  -- (BDR-008 §3.4): enrol_welcome_offer (126), for the allocation of the
  -- welcome campaign that is enrolling right now. It marks its own
  -- transaction with the campaign id, which a PostgREST caller cannot do
  -- (set_config is not exposed), so every other auto_award call is still
  -- refused exactly as before.
  IF p_claim_mode='auto_award' AND NOT EXISTS(
    SELECT 1 FROM welcome_offer_campaigns wc
     WHERE wc.allocation_id=p_allocation_id
       AND wc.state='enrolling'
       AND wc.id::TEXT=current_setting('akiba.welcome_enrolment',true)
  ) THEN
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
          -- "this merchant" is the whole eligible set once an allocation
          -- names several (BDR-006 §4.3): a member who has redeemed at ANY of
          -- them does not qualify. The rule exists so a funded offer buys new
          -- customers, and the looser reading would let a regular of one
          -- stall claim and then spend at that same stall.
          v_rule_satisfied:=NOT EXISTS(
            SELECT 1 FROM voucher_redemptions vr
            WHERE vr.hub_user_id=p_hub_user_id
              AND vr.merchant_id IN (
                SELECT em FROM voucher_allocation_eligible_merchants(p_allocation_id) AS em
              )
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
) IS 'Multi-merchant funded claims (113, carried forward unchanged by 126 apart from the auto_award gate): self_claim and internal_grant enabled; auto_award enabled only inside enrol_welcome_offer for the enrolling welcome campaign''s allocation (BDR-008). The rules snapshot carries discount_percent and maximum_discount_kes so redeem_kes_voucher_and_award_atomic can compute a percent_off benefit at the till, and a percent_off template missing either field is refused at claim time with BENEFIT_CONFIGURATION_INVALID rather than issuing a voucher no till can honour. The claim_day_of_week rule gates claims on the local calendar day (EXTRACT(DOW) numbering, default Africa/Nairobi) and fails closed on a malformed day list or unrecognised timezone. no_prior_merchant_redemption is evaluated against the allocation''s whole eligible merchant set, not just its primary. Canonical identity is resolved from hub_user_canonicals by p_hub_user_id and must equal p_canonical_id exactly (fails closed on missing or mismatched mapping). Country, username, and every configured eligibility rule are re-evaluated here from persisted database state — p_country_code, p_country_assurance, p_eligibility_snapshot, p_evidence_refs, p_rule_set_id, and p_rule_set_version are accepted for call-signature compatibility only and are never trusted as authorization. user_address is always stored NULL.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Enrolment
-- ══════════════════════════════════════════════════════════════════════════════

-- What a member is told about their welcome offer. Never exposes budget,
-- payout or identity data.
CREATE OR REPLACE FUNCTION welcome_offer_summary(p_enrolment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN iv.id IS NULL THEN
      jsonb_build_object('state', 'unavailable', 'reason', 'voucher_unavailable')
    ELSE jsonb_build_object(
      'state', CASE
        WHEN iv.status = 'redeemed' OR iv.redeemed_at IS NOT NULL THEN 'redeemed'
        WHEN iv.status IN ('expired', 'void') OR iv.expires_at <= now() THEN 'expired'
        ELSE 'awarded'
      END,
      'voucherId', iv.id,
      'discountPercent', (iv.rules_snapshot->>'discount_percent')::numeric,
      'maximumDiscountKes', (iv.rules_snapshot->>'maximum_discount_kes')::numeric,
      'minimumSpendKes', (iv.rules_snapshot->>'minimum_spend_kes')::numeric,
      'expiresAt', iv.expires_at,
      'enrolledAt', e.enrolled_at
    )
  END
  FROM welcome_offer_enrolments e
  LEFT JOIN issued_vouchers iv ON iv.id = e.issued_voucher_id
  WHERE e.id = p_enrolment_id
$$;

CREATE OR REPLACE FUNCTION enrol_welcome_offer(p_hub_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical uuid;
  v_enrolment welcome_offer_enrolments%ROWTYPE;
  v_campaign  welcome_offer_campaigns%ROWTYPE;
  v_created   timestamptz;
  v_enrolled  integer;
  v_claim     record;
BEGIN
  IF p_hub_user_id IS NULL THEN
    RAISE EXCEPTION 'HUB_USER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT canonical_id INTO v_canonical FROM hub_user_canonicals WHERE hub_user_id = p_hub_user_id;
  IF v_canonical IS NULL THEN
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'identity_unavailable');
  END IF;

  -- One member, one outcome: two simultaneous calls (a double tap, a retry
  -- racing the original) see each other's enrolment.
  PERFORM pg_advisory_xact_lock(hashtext('welcome-offer-member:' || v_canonical::text));

  -- A retry returns the enrolment it already has, with its original expiry.
  SELECT * INTO v_enrolment FROM welcome_offer_enrolments WHERE canonical_id = v_canonical;
  IF FOUND THEN
    RETURN welcome_offer_summary(v_enrolment.id);
  END IF;

  -- Locking the campaign row serialises capacity: the 1,000th and 1,001st
  -- member cannot both see 999.
  SELECT * INTO v_campaign FROM welcome_offer_campaigns WHERE state = 'enrolling' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'campaign_unavailable');
  END IF;
  IF now() < v_campaign.enrolment_starts_at THEN
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'campaign_not_started');
  END IF;
  IF v_campaign.enrolment_ends_at IS NOT NULL AND now() >= v_campaign.enrolment_ends_at THEN
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'campaign_closed');
  END IF;

  SELECT created_at INTO v_created FROM auth.users WHERE id = p_hub_user_id;
  IF v_created IS NULL OR v_created < v_campaign.enrolment_starts_at THEN
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'existing_member');
  END IF;

  SELECT count(*) INTO v_enrolled FROM welcome_offer_enrolments WHERE campaign_id = v_campaign.id;
  -- The allocation running out (quantity or budget) is the same thing to a
  -- member as reaching the cap.
  IF v_enrolled >= v_campaign.enrolment_cap
     OR EXISTS (SELECT 1 FROM voucher_funding_allocations
                 WHERE id = v_campaign.allocation_id AND state = 'exhausted') THEN
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'campaign_full');
  END IF;

  -- The mark the claim RPC checks before allowing auto_award. Local to this
  -- transaction and cleared straight after.
  PERFORM set_config('akiba.welcome_enrolment', v_campaign.id::text, true);
  BEGIN
    SELECT * INTO v_claim FROM claim_akiba_funded_voucher_atomic(
      v_campaign.allocation_id, v_canonical, 'auto_award', 'welcome:' || v_canonical::text,
      p_hub_user_id, NULL, NULL, NULL, '{}'::jsonb, '{}'::jsonb, NULL, NULL,
      'system', 'welcome_enrolment'
    );
  EXCEPTION WHEN OTHERS THEN
    -- Everything the claim did is rolled back to this block's savepoint.
    PERFORM set_config('akiba.welcome_enrolment', '', true);
    RETURN jsonb_build_object('state', 'unavailable', 'reason', 'temporary_failure', 'detail', SQLERRM);
  END;
  PERFORM set_config('akiba.welcome_enrolment', '', true);

  IF NOT v_claim.ok THEN
    RETURN jsonb_build_object(
      'state', 'unavailable',
      'reason', CASE
        WHEN v_claim.error_code IN ('QUANTITY_EXHAUSTED', 'BUDGET_EXHAUSTED') THEN 'campaign_full'
        WHEN v_claim.error_code IN ('ALLOCATION_NOT_CLAIMABLE', 'PROGRAM_NOT_LIVE') THEN 'campaign_unavailable'
        WHEN v_claim.error_code IN ('COUNTRY_PROFILE_REQUIRED', 'COUNTRY_NOT_ELIGIBLE', 'USERNAME_REQUIRED',
                                    'ELIGIBILITY_REQUIREMENTS_NOT_MET', 'ALREADY_CLAIMED') THEN 'not_eligible'
        ELSE 'temporary_failure'
      END,
      'detail', v_claim.error_code
    );
  END IF;

  INSERT INTO welcome_offer_enrolments (campaign_id, canonical_id, hub_user_id, issued_voucher_id, voucher_claim_id)
  VALUES (v_campaign.id, v_canonical, p_hub_user_id, v_claim.voucher_id, v_claim.claim_id)
  RETURNING * INTO v_enrolment;

  RETURN welcome_offer_summary(v_enrolment.id);
END;
$$;

-- Read-only: the member's existing welcome offer, for screens that show it
-- again later. Never enrols — an old member opening the app must not get one.
CREATE OR REPLACE FUNCTION get_welcome_offer(p_hub_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT welcome_offer_summary(e.id)
       FROM welcome_offer_enrolments e
       JOIN hub_user_canonicals huc ON huc.canonical_id = e.canonical_id
      WHERE huc.hub_user_id = p_hub_user_id),
    jsonb_build_object('state', 'none')
  )
$$;

REVOKE ALL ON FUNCTION welcome_offer_summary(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enrol_welcome_offer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_welcome_offer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enrol_welcome_offer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_welcome_offer(uuid) TO service_role;
