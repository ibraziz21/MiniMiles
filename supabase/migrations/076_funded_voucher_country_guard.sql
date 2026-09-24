-- Funded vouchers are country-scoped. Eligibility previews and admin rule
-- sets improve UX, but the database is the final enforcement boundary: no
-- claim may be recorded unless the canonical member's stored profile country
-- matches the funding program's ISO-2 country.

CREATE OR REPLACE FUNCTION public.normalize_funded_voucher_country(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_country, '')))
    WHEN 'kenya' THEN 'KE'
    WHEN 'uganda' THEN 'UG'
    WHEN 'tanzania' THEN 'TZ'
    WHEN 'nigeria' THEN 'NG'
    WHEN 'ghana' THEN 'GH'
    WHEN 'rwanda' THEN 'RW'
    WHEN 'south africa' THEN 'ZA'
    WHEN 'zambia' THEN 'ZM'
    WHEN 'ethiopia' THEN 'ET'
    ELSE CASE
      WHEN btrim(COALESCE(p_country, '')) ~* '^[a-z]{2}$'
        THEN upper(btrim(p_country))
      ELSE NULL
    END
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_funded_voucher_claim_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fund_country   text;
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

  SELECT public.normalize_funded_voucher_country(profile.country)
    INTO v_member_country
  FROM public.hub_user_canonicals canonical
  JOIN public.hub_user_profiles profile
    ON profile.user_id = canonical.hub_user_id
  WHERE canonical.canonical_id = NEW.canonical_id
    AND public.normalize_funded_voucher_country(profile.country) IS NOT NULL
  ORDER BY profile.updated_at DESC
  LIMIT 1;

  IF v_member_country IS NULL THEN
    SELECT public.normalize_funded_voucher_country(legacy_user.country)
      INTO v_member_country
    FROM public.identity_links identity
    JOIN public.users legacy_user
      ON lower(legacy_user.user_address) = lower(identity.identity_value)
    WHERE identity.canonical_id = NEW.canonical_id
      AND identity.identity_type = 'wallet'
      AND public.normalize_funded_voucher_country(legacy_user.country) IS NOT NULL
    ORDER BY legacy_user.created_at ASC
    LIMIT 1;
  END IF;

  IF v_member_country IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_PROFILE_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_member_country <> v_fund_country THEN
    RAISE EXCEPTION 'COUNTRY_NOT_ELIGIBLE'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.country_code := v_member_country;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funded_voucher_claim_country
  ON public.voucher_claims;
CREATE TRIGGER trg_funded_voucher_claim_country
  BEFORE INSERT ON public.voucher_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_funded_voucher_claim_country();

REVOKE ALL ON FUNCTION public.normalize_funded_voucher_country(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_funded_voucher_claim_country()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_funded_voucher_claim_country() IS
  'Fails closed when a funded-voucher claimant country is missing or differs from the funding program country.';
