-- Admin reporting projection for Akiba Pass acquisition.
-- A Pass row is created once per Hub user, so hub_user_passes.created_at is
-- the canonical signup timestamp for Pass reporting.

CREATE OR REPLACE FUNCTION public.get_admin_pass_analytics(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH bounds AS (
    SELECT
      (p_from::timestamp AT TIME ZONE 'Africa/Nairobi') AS starts_at,
      ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Nairobi') AS ends_at,
      timezone('Africa/Nairobi', now())::date AS today
  ),
  period_passes AS (
    SELECT
      hup.created_at,
      hup.onboarding_seen_at,
      COALESCE(NULLIF(btrim(hup.signup_src), ''), 'Direct / unknown') AS signup_source
    FROM public.hub_user_passes hup
    CROSS JOIN bounds b
    WHERE hup.created_at >= b.starts_at
      AND hup.created_at < b.ends_at
  ),
  days AS (
    SELECT generate_series(p_from, p_to, interval '1 day')::date AS signup_day
  ),
  daily AS (
    SELECT
      d.signup_day,
      count(pp.created_at)::bigint AS signups,
      count(pp.onboarding_seen_at)::bigint AS onboarding_seen
    FROM days d
    LEFT JOIN period_passes pp
      ON timezone('Africa/Nairobi', pp.created_at)::date = d.signup_day
    GROUP BY d.signup_day
    ORDER BY d.signup_day
  ),
  sources AS (
    SELECT signup_source, count(*)::bigint AS signups
    FROM period_passes
    GROUP BY signup_source
    ORDER BY count(*) DESC, signup_source
  )
  SELECT jsonb_build_object(
    'total_passes', (SELECT count(*)::bigint FROM public.hub_user_passes),
    'signups_today', (
      SELECT count(*)::bigint
      FROM public.hub_user_passes hup
      CROSS JOIN bounds b
      WHERE hup.created_at >= (b.today::timestamp AT TIME ZONE 'Africa/Nairobi')
        AND hup.created_at < ((b.today + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
    ),
    'signups_yesterday', (
      SELECT count(*)::bigint
      FROM public.hub_user_passes hup
      CROSS JOIN bounds b
      WHERE hup.created_at >= ((b.today - 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
        AND hup.created_at < (b.today::timestamp AT TIME ZONE 'Africa/Nairobi')
    ),
    'signups_7_days', (
      SELECT count(*)::bigint
      FROM public.hub_user_passes hup
      CROSS JOIN bounds b
      WHERE hup.created_at >= ((b.today - 6)::timestamp AT TIME ZONE 'Africa/Nairobi')
        AND hup.created_at < ((b.today + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
    ),
    'signups_30_days', (
      SELECT count(*)::bigint
      FROM public.hub_user_passes hup
      CROSS JOIN bounds b
      WHERE hup.created_at >= ((b.today - 29)::timestamp AT TIME ZONE 'Africa/Nairobi')
        AND hup.created_at < ((b.today + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
    ),
    'period_signups', (SELECT count(*)::bigint FROM period_passes),
    'period_onboarding_seen', (SELECT count(onboarding_seen_at)::bigint FROM period_passes),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', signup_day,
        'signups', signups,
        'onboarding_seen', onboarding_seen
      ) ORDER BY signup_day)
      FROM daily
    ), '[]'::jsonb),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', signup_source,
        'signups', signups
      ) ORDER BY signups DESC, signup_source)
      FROM sources
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.get_admin_pass_analytics(date, date) IS
  'Returns Nairobi-calendar Pass signup totals, daily trend, onboarding reach, and acquisition sources for Admin.';

REVOKE ALL ON FUNCTION public.get_admin_pass_analytics(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_pass_analytics(date, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_pass_analytics(date, date) TO service_role;
