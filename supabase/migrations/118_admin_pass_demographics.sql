-- Aggregate current profiles for Pass holders; no member-level data is returned.
CREATE OR REPLACE FUNCTION public.get_admin_pass_demographics(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
WITH profiles AS MATERIALIZED (
  SELECT pass.user_id, pass.created_at,
    COALESCE(NULLIF(profile.country_code, ''),
      public.normalize_funded_voucher_country(COALESCE(NULLIF(btrim(profile.country), ''), NULLIF(btrim(legacy.country), ''))),
      NULLIF(btrim(profile.country), ''), NULLIF(btrim(legacy.country), '')) AS country,
    NULLIF(btrim(profile.city), '') AS city,
    ARRAY(SELECT DISTINCT lower(btrim(interest))
      FROM unnest(legacy.interests) AS interest
      WHERE NULLIF(btrim(interest), '') IS NOT NULL ORDER BY 1) AS interests
  FROM public.hub_user_passes pass
  LEFT JOIN public.hub_user_profiles profile ON profile.user_id = pass.user_id
  LEFT JOIN public.hub_user_wallets wallet ON wallet.user_id = pass.user_id AND wallet.ecosystem = 'minipay'
  -- Match the selected wallet first. Without one, only use an unambiguous
  -- email match, mirroring Hub profile resolution without writing a link.
  LEFT JOIN LATERAL (
    SELECT u.country, u.interests
    FROM public.users u
    WHERE (wallet.address IS NOT NULL AND lower(u.user_address) = lower(wallet.address))
       OR (wallet.address IS NULL AND u.email = pass.email
         AND (SELECT count(*) FROM public.users candidate WHERE candidate.email = pass.email) = 1)
    ORDER BY u.created_at DESC, u.user_address
    LIMIT 1
  ) legacy ON true
), cohorts AS (
  SELECT scope.name AS scope, p.*
  FROM profiles p CROSS JOIN (VALUES ('all_time'), ('selected')) scope(name)
  WHERE scope.name = 'all_time' OR (
    p.created_at >= (p_from::timestamp AT TIME ZONE 'Africa/Nairobi') AND
    p.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Nairobi'))
), dimensions AS (
  SELECT scope, user_id, 'countries' AS dimension, country AS label FROM cohorts
  UNION ALL
  SELECT scope, user_id, 'cities',
    CASE WHEN city IS NOT NULL THEN lower(city) || ' · ' || COALESCE(country, 'Country not provided') END
  FROM cohorts
  UNION ALL
  SELECT scope, user_id, 'interests', interest FROM cohorts
  CROSS JOIN LATERAL unnest(interests) interest
), counts AS (
  SELECT scope, dimension, label, count(DISTINCT user_id) AS users
  FROM dimensions WHERE label IS NOT NULL GROUP BY scope, dimension, label
), breakdowns AS (
  SELECT scopes.name AS scope, dims.name AS dimension,
    jsonb_build_object(
      'known', (SELECT count(DISTINCT d.user_id) FROM dimensions d
        WHERE d.scope = scopes.name AND d.dimension = dims.name AND d.label IS NOT NULL),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', label, 'users', users)
        ORDER BY users DESC, label) FROM counts c
        WHERE c.scope = scopes.name AND c.dimension = dims.name), '[]'::jsonb)
    ) AS data
  FROM (VALUES ('all_time'), ('selected')) scopes(name)
  CROSS JOIN (VALUES ('countries'), ('cities'), ('interests')) dims(name)
), results AS (
  SELECT scope, jsonb_object_agg(dimension, data) || jsonb_build_object(
    'total', (SELECT count(*) FROM cohorts c WHERE c.scope = breakdowns.scope)) AS data
  FROM breakdowns GROUP BY scope
)
SELECT jsonb_object_agg(scope, data) FROM results;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_pass_demographics(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_pass_demographics(date, date) TO service_role;
COMMENT ON FUNCTION public.get_admin_pass_demographics(date, date) IS
  'Current country, city and interest aggregates for all Pass holders and Nairobi-date signup cohorts. Interests use the selected MiniPay profile or a unique legacy email match.';
