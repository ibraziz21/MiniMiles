-- Service-only, paginated merchant -> member earning drill-down. Keep the
-- award definition aligned with get_admin_usage_metrics (109): gross positive
-- merchant/purchase credits. KES value is inferred spend, never a cash reward.
CREATE OR REPLACE FUNCTION public.get_admin_earning_breakdown(
  p_from timestamptz DEFAULT NULL,
  p_as_of timestamptz DEFAULT now(),
  p_merchant_key text DEFAULT NULL,
  p_page integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH awards AS MATERIALIZED (
    SELECT canonical_id, partner_id, amount, created_at
    FROM public.miles_ledger
    WHERE direction = 'credit' AND source_type IN ('merchant', 'purchase')
      AND amount > 0 AND created_at <= p_as_of
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_merchant_key IS NULL
        OR (p_merchant_key = 'unattributed' AND partner_id IS NULL)
        OR partner_id::text = p_merchant_key)
  ), summary AS (
    SELECT count(DISTINCT canonical_id) AS users_awarded,
      COALESCE(sum(amount), 0) AS miles_awarded
    FROM awards
  ), merchants AS (
    SELECT COALESCE(a.partner_id::text, 'unattributed') AS merchant_key,
      COALESCE(p.name, 'Unattributed merchant') AS merchant_name,
      count(DISTINCT a.canonical_id) AS users_awarded,
      sum(a.amount) AS miles_awarded,
      round(sum(a.amount)::numeric / NULLIF(count(DISTINCT a.canonical_id), 0), 2) AS miles_per_user
    FROM awards a LEFT JOIN public.partners p ON p.id = a.partner_id
    GROUP BY a.partner_id, p.name
  ), members AS (
    SELECT canonical_id::text AS member_id, sum(amount) AS miles_awarded,
      count(*) AS award_count, max(created_at) AS last_earned_at
    FROM awards GROUP BY canonical_id
  ), merchant_page AS (
    SELECT * FROM merchants ORDER BY miles_awarded DESC, merchant_key
    LIMIT 25 OFFSET (LEAST(GREATEST(COALESCE(p_page, 1), 1), 10000) - 1) * 25
  ), member_page AS (
    SELECT m.*, lp.username::text AS username
    FROM members m
    LEFT JOIN public.leaderboard_profiles lp ON lp.canonical_id::text = m.member_id
    ORDER BY m.miles_awarded DESC, m.member_id
    LIMIT 25 OFFSET (LEAST(GREATEST(COALESCE(p_page, 1), 1), 10000) - 1) * 25
  )
  SELECT jsonb_build_object(
    'users_awarded', s.users_awarded,
    'miles_awarded', s.miles_awarded,
    'estimated_spend_kes', s.miles_awarded * 100,
    'miles_per_user', COALESCE(round(s.miles_awarded::numeric / NULLIF(s.users_awarded, 0), 2), 0),
    'merchant_name', CASE WHEN p_merchant_key = 'unattributed' THEN 'Unattributed merchant'
      ELSE (SELECT name FROM public.partners WHERE id::text = p_merchant_key) END,
    'total_rows', CASE WHEN p_merchant_key IS NULL THEN (SELECT count(*) FROM merchants)
      ELSE (SELECT count(*) FROM members) END,
    'merchants', CASE WHEN p_merchant_key IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(mp) || jsonb_build_object('estimated_spend_kes', mp.miles_awarded * 100)
        ORDER BY mp.miles_awarded DESC, mp.merchant_key) FROM merchant_page mp
    ), '[]'::jsonb) END,
    'members', CASE WHEN p_merchant_key IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(up) || jsonb_build_object('estimated_spend_kes', up.miles_awarded * 100)
        ORDER BY up.miles_awarded DESC, up.member_id) FROM member_page up
    ), '[]'::jsonb) END
  ) FROM summary s;
$function$;
REVOKE ALL ON FUNCTION public.get_admin_earning_breakdown(timestamptz, timestamptz, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_earning_breakdown(timestamptz, timestamptz, text, integer) TO service_role;
