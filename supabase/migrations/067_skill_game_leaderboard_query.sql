-- Skill game leaderboards — Phase 3 (skill-games-leaderboards-spec.md §4.2,
-- §2.2, §2.3, §2.4).
--
-- The single canonical ranking query both apps' BFFs call. Computes its own
-- Africa/Nairobi period bounds (callers cannot supply timestamps), resolves
-- the §2.3 participant key, applies the §2.2 tie-break order, and resolves a
-- display name per §2.4/§4.3 without ever selecting email or full name.

CREATE OR REPLACE FUNCTION get_skill_game_leaderboard(
  p_game_type            text,
  p_scope                text,       -- 'daily' | 'weekly'
  p_viewer_canonical_id  uuid,
  p_limit                integer DEFAULT 20
)
RETURNS TABLE(
  entries       jsonb,
  my_best       jsonb,
  period_start  timestamptz,
  period_end    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start        timestamptz;
  v_end          timestamptz;
  v_day_nairobi  date;
  v_monday       date;
BEGIN
  IF p_game_type NOT IN ('rule_tap', 'memory_flip') THEN
    RAISE EXCEPTION 'invalid game_type %', p_game_type USING ERRCODE = '22023';
  END IF;
  IF p_scope NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'invalid scope %', p_scope USING ERRCODE = '22023';
  END IF;

  v_day_nairobi := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  IF p_scope = 'daily' THEN
    v_start := v_day_nairobi::timestamp AT TIME ZONE 'Africa/Nairobi';
    v_end   := (v_day_nairobi + 1)::timestamp AT TIME ZONE 'Africa/Nairobi';
  ELSE
    -- extract(isodow ...) is 1 (Mon) .. 7 (Sun) — walk back to that week's Monday.
    v_monday := v_day_nairobi - (extract(isodow FROM v_day_nairobi)::int - 1);
    v_start  := v_monday::timestamp AT TIME ZONE 'Africa/Nairobi';
    v_end    := (v_monday + 7)::timestamp AT TIME ZONE 'Africa/Nairobi';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      s.session_id,
      s.score,
      s.elapsed_ms,
      s.created_at,
      s.reward_miles,
      COALESCE(s.canonical_id, il.canonical_id) AS resolved_canonical,
      COALESCE(
        s.canonical_id::text,
        il.canonical_id::text,
        'wallet:' || lower(s.wallet_address)
      ) AS participant_key
    FROM skill_game_sessions s
    LEFT JOIN identity_links il
      ON s.canonical_id IS NULL
     AND s.wallet_address IS NOT NULL
     AND il.identity_type = 'wallet'
     AND il.identity_value = lower(s.wallet_address)
    WHERE s.game_type = p_game_type
      AND s.accepted = true
      AND s.created_at >= v_start
      AND s.created_at < v_end
  ),
  best AS (
    SELECT c.*, ROW_NUMBER() OVER (
      PARTITION BY participant_key
      ORDER BY score DESC, elapsed_ms ASC NULLS LAST, created_at ASC, session_id ASC
    ) AS rn
    FROM candidates c
  ),
  ranked AS (
    SELECT b.*, ROW_NUMBER() OVER (
      ORDER BY score DESC, elapsed_ms ASC NULLS LAST, created_at ASC, session_id ASC
    ) AS rank
    FROM best b
    WHERE rn = 1
  ),
  named AS (
    SELECT
      r.*,
      COALESCE(
        lp.username::text,
        (
          SELECT lu.username
          FROM identity_links il2
          JOIN users lu ON lu.user_address = il2.identity_value
          WHERE il2.canonical_id = r.resolved_canonical
            AND il2.identity_type = 'wallet'
            AND lu.username IS NOT NULL
          ORDER BY il2.identity_value
          LIMIT 1
        ),
        'Player ' || upper(left(replace(COALESCE(r.resolved_canonical::text, r.participant_key), '-', ''), 4))
      ) AS display_name
    FROM ranked r
    LEFT JOIN leaderboard_profiles lp ON lp.canonical_id = r.resolved_canonical
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'rank',         n.rank,
        'playerKey',    n.participant_key,
        'displayName',  n.display_name,
        'score',        n.score,
        'rewardMiles',  n.reward_miles,
        'elapsedMs',    n.elapsed_ms,
        'playedAt',     n.created_at,
        'isYou',        (p_viewer_canonical_id IS NOT NULL AND n.resolved_canonical = p_viewer_canonical_id)
      ) ORDER BY n.rank), '[]'::jsonb)
     FROM named n WHERE n.rank <= p_limit) AS entries,
    (SELECT jsonb_build_object(
        'rank',         n.rank,
        'playerKey',    n.participant_key,
        'displayName',  n.display_name,
        'score',        n.score,
        'rewardMiles',  n.reward_miles,
        'elapsedMs',    n.elapsed_ms,
        'playedAt',     n.created_at,
        'isYou',        true
      )
     FROM named n
     WHERE p_viewer_canonical_id IS NOT NULL AND n.resolved_canonical = p_viewer_canonical_id
     ORDER BY n.rank LIMIT 1) AS my_best,
    v_start AS period_start,
    v_end AS period_end;
END;
$$;

REVOKE ALL ON FUNCTION get_skill_game_leaderboard(text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_skill_game_leaderboard(text, text, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
