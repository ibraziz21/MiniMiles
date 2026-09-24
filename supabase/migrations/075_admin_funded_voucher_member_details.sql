-- Service-only member context for the Admin funded-voucher review surface.
--
-- Keeps auth.users and identity internals behind a narrow RPC. Callers provide
-- only the voucher ids already in scope and receive the four signals needed to
-- assess likely redemption: username, account creation date, country, and
-- AkibaMiles earned from merchant spend.

CREATE OR REPLACE FUNCTION public.get_admin_funded_voucher_member_details(
  p_voucher_ids uuid[]
)
RETURNS TABLE (
  voucher_id                uuid,
  username                  text,
  account_created_at        timestamptz,
  country                   text,
  spend_miles_earned        bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH selected_vouchers AS (
    SELECT
      iv.id,
      iv.canonical_id,
      iv.hub_user_id,
      iv.user_address
    FROM public.issued_vouchers iv
    WHERE iv.id = ANY(COALESCE(p_voucher_ids, ARRAY[]::uuid[]))
      AND iv.funding_allocation_id IS NOT NULL
  ),
  spend_earnings AS (
    SELECT
      ml.canonical_id,
      SUM(ml.amount)::bigint AS miles_earned
    FROM public.miles_ledger ml
    JOIN (
      SELECT DISTINCT canonical_id
      FROM selected_vouchers
      WHERE canonical_id IS NOT NULL
    ) selected_canonicals ON selected_canonicals.canonical_id = ml.canonical_id
    WHERE ml.direction = 'credit'
      AND ml.source_type = 'merchant'
    GROUP BY ml.canonical_id
  )
  SELECT
    sv.id AS voucher_id,
    COALESCE(lp.username::text, legacy_user.username) AS username,
    COALESCE(auth_user.created_at, legacy_user.created_at, hub_profile.created_at) AS account_created_at,
    COALESCE(NULLIF(btrim(hub_profile.country), ''), NULLIF(btrim(legacy_user.country), '')) AS country,
    COALESCE(se.miles_earned, 0)::bigint AS spend_miles_earned
  FROM selected_vouchers sv
  LEFT JOIN public.leaderboard_profiles lp
    ON lp.canonical_id = sv.canonical_id
  LEFT JOIN public.hub_user_profiles hub_profile
    ON hub_profile.user_id = sv.hub_user_id
  LEFT JOIN auth.users auth_user
    ON auth_user.id = sv.hub_user_id
  LEFT JOIN public.users legacy_user
    ON lower(legacy_user.user_address) = lower(sv.user_address)
  LEFT JOIN spend_earnings se
    ON se.canonical_id = sv.canonical_id;
$$;

REVOKE ALL ON FUNCTION public.get_admin_funded_voucher_member_details(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_funded_voucher_member_details(uuid[])
  TO service_role;

COMMENT ON FUNCTION public.get_admin_funded_voucher_member_details(uuid[]) IS
  'Service-only member context for Akiba-funded voucher redemption review.';
