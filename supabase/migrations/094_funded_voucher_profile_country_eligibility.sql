-- akiba-funded-voucher-profile-country-eligibility-spec.md
--
-- Akiba-funded vouchers are country-scoped to the exact member's saved Hub
-- profile, never a canonical identity's other accounts and never a legacy
-- wallet row. This migration:
--   1. adds a canonical ISO-2 `country_code` to hub_user_profiles;
--   2. backfills it from the existing free-text `country` display field;
--   3. hardens `set_hub_profile_country` to validate against the supported
--      catalogue, write the canonical code under the shared per-user
--      advisory lock, and audit subsequent (non-first-set) changes;
--   4. replaces 076's claim-country trigger so it resolves the exact
--      recipient from the issued voucher and reads only
--      hub_user_profiles.country_code — no canonical-identity fan-out, no
--      legacy wallet fallback.
--
-- Supersedes 076_funded_voucher_country_guard.sql's trigger function; does
-- not edit that deployed migration (spec §15.7).

-- ── hub_user_profiles.country_code ──────────────────────────────────────────

ALTER TABLE public.hub_user_profiles
  ADD COLUMN IF NOT EXISTS country_code text;

ALTER TABLE public.hub_user_profiles
  DROP CONSTRAINT IF EXISTS hub_user_profiles_country_code_iso2;
ALTER TABLE public.hub_user_profiles
  ADD CONSTRAINT hub_user_profiles_country_code_iso2
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- ── hub_profile_country_audit ────────────────────────────────────────────────
-- Restricted audit trail for country changes (spec §6.3). Only previous/new
-- ISO-2 codes, actor, and timestamp — no wallet, email, or other profile
-- data. Service-role only; no end-user read policy.

CREATE TABLE IF NOT EXISTS public.hub_profile_country_audit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_code text,
  new_code      text,
  actor         uuid        NOT NULL REFERENCES auth.users(id),
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_profile_country_audit_user
  ON public.hub_profile_country_audit (user_id, changed_at DESC);

ALTER TABLE public.hub_profile_country_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.hub_profile_country_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hub_profile_country_audit TO service_role;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Only recognized existing display values normalize; blank, `Other`, and
-- unrecognized free text stay NULL (spec §5.3 — never guess from legacy
-- wallet rows).

DO $$
DECLARE
  v_recognized   int;
  v_total_set    int;
  v_unset        int;
  v_unrecognized int;
BEGIN
  UPDATE public.hub_user_profiles
  SET country_code = public.normalize_funded_voucher_country(country)
  WHERE country_code IS NULL
    AND public.normalize_funded_voucher_country(country) IS NOT NULL;
  GET DIAGNOSTICS v_recognized = ROW_COUNT;

  SELECT count(*) INTO v_total_set FROM public.hub_user_profiles WHERE country_code IS NOT NULL;
  SELECT count(*) INTO v_unset FROM public.hub_user_profiles WHERE country IS NULL OR btrim(country) = '';
  SELECT count(*) INTO v_unrecognized FROM public.hub_user_profiles
    WHERE country_code IS NULL AND country IS NOT NULL AND btrim(country) <> '';

  RAISE NOTICE
    'hub_user_profiles.country_code backfill: % recognized and populated, % already canonical, % unset, % unrecognized',
    v_recognized, v_total_set - v_recognized, v_unset, v_unrecognized;
END $$;

-- ── set_hub_profile_country ──────────────────────────────────────────────────
-- Adds: the shared per-user advisory lock (same key the funded-claim RPC
-- takes, so a concurrent profile change and claim serialize deterministically
-- — spec §10.5), supported-catalogue validation, canonical `country_code`
-- write, and a restricted audit row on a genuine country *change* (not the
-- first set, which already emits profile_country_set below).

CREATE OR REPLACE FUNCTION public.set_hub_profile_country(
  p_user_id    uuid,
  p_identities jsonb,
  p_country    text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev_country      text;
  v_prev_country_code text;
  v_country_code      text;
BEGIN
  IF p_country IS NULL OR btrim(p_country) = '' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hub-profile-country:' || p_user_id::text));

  v_country_code := public.normalize_funded_voucher_country(p_country);
  IF v_country_code IS NULL AND lower(btrim(p_country)) <> 'other' THEN
    RAISE EXCEPTION 'COUNTRY_VALUE_UNSUPPORTED'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT country, country_code INTO v_prev_country, v_prev_country_code
  FROM public.hub_user_profiles WHERE user_id = p_user_id;

  INSERT INTO public.hub_user_profiles (user_id, country, country_code, updated_at)
  VALUES (p_user_id, p_country, v_country_code, now())
  ON CONFLICT (user_id) DO UPDATE
    SET country = EXCLUDED.country, country_code = EXCLUDED.country_code, updated_at = now();

  IF v_prev_country_code IS NOT NULL AND v_prev_country_code IS DISTINCT FROM v_country_code THEN
    INSERT INTO public.hub_profile_country_audit (user_id, previous_code, new_code, actor)
    VALUES (p_user_id, v_prev_country_code, v_country_code, p_user_id);
  END IF;

  IF v_prev_country IS NULL OR btrim(v_prev_country) = '' THEN
    INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
    VALUES (
      'profile_country_set',
      'profile_country:' || p_user_id::text,
      COALESCE(p_identities, '[]'::jsonb),
      jsonb_build_object('userId', p_user_id, 'country', p_country)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
END;
$$;

-- ── enforce_funded_voucher_claim_country (supersedes 076) ───────────────────
-- Resolves the exact recipient hub_user_id from the issued voucher linked by
-- NEW.issued_voucher_id — never NEW.canonical_id's other linked accounts and
-- never a legacy `users.country` wallet row (spec §10.4). Fails closed if the
-- issued voucher, its Hub user, or a recognized profile country_code is
-- missing.

CREATE OR REPLACE FUNCTION public.enforce_funded_voucher_claim_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fund_country   text;
  v_hub_user_id    uuid;
  v_member_country text;
BEGIN
  SELECT public.normalize_funded_voucher_country(program.country_code)
    INTO v_fund_country
  FROM public.voucher_funding_allocations allocation
  JOIN public.voucher_funding_programs program
    ON program.id = allocation.program_id
  WHERE allocation.id = NEW.allocation_id;

  IF v_fund_country IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_POLICY_UNAVAILABLE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT issued.hub_user_id INTO v_hub_user_id
  FROM public.issued_vouchers issued
  WHERE issued.id = NEW.issued_voucher_id;

  IF v_hub_user_id IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_PROFILE_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT profile.country_code INTO v_member_country
  FROM public.hub_user_profiles profile
  WHERE profile.user_id = v_hub_user_id;

  IF v_member_country IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_PROFILE_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_member_country <> v_fund_country THEN
    RAISE EXCEPTION 'COUNTRY_NOT_ELIGIBLE'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.country_code := v_member_country;
  NEW.country_assurance := 'self_declared_profile';
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_funded_voucher_claim_country() IS
  'Fails closed when the exact claiming hub_user''s saved profile country is missing or differs from the funding program country. No canonical-identity or legacy-wallet fallback.';
