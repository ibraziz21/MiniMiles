-- Aggregate inside Postgres so totals and distinct users cannot be truncated
-- by PostgREST's row limit. Gross merchant/purchase awards exclude legacy
-- games, campaigns and referral credits; reversals do not count as awards.
CREATE OR REPLACE FUNCTION public.get_admin_usage_metrics(
  p_week_start timestamptz,
  p_as_of timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH awards AS (
    SELECT canonical_id, amount, created_at
    FROM public.miles_ledger
    WHERE direction = 'credit'
      AND source_type IN ('merchant', 'purchase')
      AND amount > 0
      AND created_at <= p_as_of
  ), totals AS (
    SELECT
      count(DISTINCT canonical_id) AS total_users,
      COALESCE(sum(amount), 0) AS total_miles,
      count(DISTINCT canonical_id) FILTER (WHERE created_at >= p_week_start) AS weekly_users,
      COALESCE(sum(amount) FILTER (WHERE created_at >= p_week_start), 0) AS weekly_miles
    FROM awards
  )
  SELECT jsonb_build_object(
    'total_users_awarded', total_users,
    'total_miles_awarded', total_miles,
    'weekly_users_awarded', weekly_users,
    'weekly_miles_awarded', weekly_miles,
    'weekly_average_spend', CASE WHEN weekly_users = 0 THEN 0
      ELSE round(weekly_miles::numeric / weekly_users, 2) END
  ) FROM totals;
$function$;
REVOKE ALL ON FUNCTION public.get_admin_usage_metrics(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_usage_metrics(timestamptz, timestamptz) TO service_role;
