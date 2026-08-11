-- Skill game leaderboards — Phase 2 (skill-games-leaderboards-spec.md §2.4, §4.3).
--
-- Public @username identity for leaderboard rows. Deliberately separate from
-- `users.full_name`/email: the leaderboard must never be able to select or
-- render either (§2.4, invariant #3).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS leaderboard_profiles (
  canonical_id        uuid PRIMARY KEY,
  username             citext NOT NULL UNIQUE,
  username_normalized  text GENERATED ALWAYS AS (lower(username::text)) STORED,
  changed_at           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (username::text ~ '^[a-z0-9_]{3,20}$')
);

CREATE TABLE IF NOT EXISTS leaderboard_username_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id  uuid NOT NULL,
  old_username  text,
  new_username  text NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_username_changes_canonical
  ON leaderboard_username_changes (canonical_id, changed_at);

-- Reserved/brand names an operator can extend without a new migration —
-- deliberately data, not a hardcoded list in function code. Profanity
-- moderation is expected to grow this table over time.
CREATE TABLE IF NOT EXISTS leaderboard_username_blocklist (
  term        text PRIMARY KEY,
  reason      text NOT NULL DEFAULT 'reserved',
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO leaderboard_username_blocklist (term, reason) VALUES
  ('admin', 'reserved'), ('administrator', 'reserved'), ('support', 'reserved'),
  ('moderator', 'reserved'), ('official', 'reserved'), ('staff', 'reserved'),
  ('help', 'reserved'), ('system', 'reserved'), ('root', 'reserved'),
  ('null', 'reserved'), ('undefined', 'reserved'), ('test', 'reserved'),
  ('akiba', 'brand'), ('akibamiles', 'brand'), ('akibapass', 'brand'),
  ('minimiles', 'brand'), ('minipay', 'brand')
ON CONFLICT (term) DO NOTHING;

ALTER TABLE leaderboard_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_username_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_username_blocklist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON leaderboard_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON leaderboard_username_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON leaderboard_username_blocklist FROM PUBLIC, anon, authenticated;

-- SELECT is granted broadly on the profile table itself (not through this
-- grant though — the leaderboard query function in the next migration reads
-- it as SECURITY DEFINER) so this stays service_role-only like every other
-- table in this feature.
GRANT SELECT, INSERT, UPDATE ON leaderboard_profiles TO service_role;
GRANT SELECT, INSERT ON leaderboard_username_changes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON leaderboard_username_blocklist TO service_role;

DROP TRIGGER IF EXISTS trg_leaderboard_profiles_touch ON leaderboard_profiles;
CREATE OR REPLACE FUNCTION touch_leaderboard_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_leaderboard_profiles_touch
  BEFORE UPDATE ON leaderboard_profiles
  FOR EACH ROW
  EXECUTE FUNCTION touch_leaderboard_profiles_updated_at();

-- Claims or changes a canonical member's public leaderboard username.
-- ok=false + error_code lets the API route surface a specific reason instead
-- of a raw constraint-violation message. Client routes must resolve
-- p_canonical_id server-side (§4.3) — this function never trusts one from
-- the browser.
CREATE OR REPLACE FUNCTION set_leaderboard_username(
  p_canonical_id uuid,
  p_username     text
)
RETURNS TABLE(
  ok           boolean,
  error_code   text,
  username     text,
  changed_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username   text := lower(btrim(COALESCE(p_username, '')));
  v_existing   leaderboard_profiles%ROWTYPE;
  v_taken_by   uuid;
BEGIN
  IF p_canonical_id IS NULL THEN
    RETURN QUERY SELECT false, 'canonical-required', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('leaderboard_username:' || p_canonical_id::text, 0));

  IF v_username !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN QUERY SELECT false, 'invalid-format', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM leaderboard_username_blocklist WHERE term = v_username) THEN
    RETURN QUERY SELECT false, 'reserved-name', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM leaderboard_profiles WHERE canonical_id = p_canonical_id FOR UPDATE;

  -- No-op: re-submitting the current username costs nothing and doesn't
  -- burn the cooldown.
  IF v_existing.canonical_id IS NOT NULL AND v_existing.username_normalized = v_username THEN
    RETURN QUERY SELECT true, NULL::text, v_existing.username::text, v_existing.changed_at;
    RETURN;
  END IF;

  IF NOT check_rate_limit('leaderboard_username:' || p_canonical_id::text, 5, 3600) THEN
    RETURN QUERY SELECT false, 'rate-limited', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_existing.canonical_id IS NOT NULL AND v_existing.changed_at > now() - interval '30 days' THEN
    RETURN QUERY SELECT false, 'cooldown-active', v_existing.username::text, v_existing.changed_at;
    RETURN;
  END IF;

  SELECT canonical_id INTO v_taken_by
  FROM leaderboard_profiles
  WHERE username_normalized = v_username AND canonical_id <> p_canonical_id
  FOR UPDATE;
  IF v_taken_by IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already-taken', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO leaderboard_username_changes (canonical_id, old_username, new_username)
  VALUES (p_canonical_id, v_existing.username::text, v_username);

  INSERT INTO leaderboard_profiles (canonical_id, username, changed_at)
  VALUES (p_canonical_id, v_username, now())
  ON CONFLICT (canonical_id) DO UPDATE SET
    username = EXCLUDED.username,
    changed_at = now()
  RETURNING * INTO v_existing;

  RETURN QUERY SELECT true, NULL::text, v_existing.username::text, v_existing.changed_at;
END;
$$;

REVOKE ALL ON FUNCTION set_leaderboard_username(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_leaderboard_username(uuid, text) TO service_role;

-- ── Canonical merge must also move the claimed username ────────────────────
-- 065_skill_game_leaderboard_foundation.sql extended merge_partner_quest_
-- canonicals with the skill-game tables, but leaderboard_profiles didn't
-- exist yet at that point in migration order — added here instead. If the
-- surviving canonical already has a claimed username, the merged canonical's
-- profile is dropped (its username becomes claimable again) rather than
-- violating the PRIMARY KEY on canonical_id; otherwise the merged row simply
-- moves to the surviving canonical, preserving its username and changed_at
-- cooldown clock.
CREATE OR REPLACE FUNCTION merge_partner_quest_canonicals(
  p_surviving_canonical uuid,
  p_merged_canonical    uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row              api_partner_quest_completions%ROWTYPE;
  v_existing_id      uuid;
  v_loser_delivery   api_partner_quest_reward_deliveries%ROWTYPE;
  v_kept_delivery    api_partner_quest_reward_deliveries%ROWTYPE;
  v_loser_rank       integer;
  v_kept_rank        integer;
BEGIN
  IF p_surviving_canonical = p_merged_canonical THEN
    RETURN p_surviving_canonical;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(p_surviving_canonical::text, p_merged_canonical::text), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(p_surviving_canonical::text, p_merged_canonical::text), 0));

  IF EXISTS (SELECT 1 FROM hub_user_canonicals WHERE canonical_id = p_surviving_canonical)
     AND EXISTS (SELECT 1 FROM hub_user_canonicals WHERE canonical_id = p_merged_canonical)
  THEN
    RAISE EXCEPTION 'cannot automatically merge two Hub accounts' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT * FROM api_partner_quest_completions
    WHERE canonical_id = p_merged_canonical
    FOR UPDATE
  LOOP
    SELECT id INTO v_existing_id
    FROM api_partner_quest_completions
    WHERE canonical_id = p_surviving_canonical
      AND api_partner_quest_id = v_row.api_partner_quest_id
      AND scope_key = v_row.scope_key
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      UPDATE api_partner_quest_completions
      SET canonical_id = p_surviving_canonical
      WHERE id = v_row.id;
    ELSE
      SELECT * INTO v_loser_delivery
      FROM api_partner_quest_reward_deliveries WHERE completion_id = v_row.id FOR UPDATE;
      SELECT * INTO v_kept_delivery
      FROM api_partner_quest_reward_deliveries WHERE completion_id = v_existing_id FOR UPDATE;

      v_loser_rank := CASE v_loser_delivery.status
        WHEN 'completed' THEN 4 WHEN 'processing' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END;
      v_kept_rank := CASE v_kept_delivery.status
        WHEN 'completed' THEN 4 WHEN 'processing' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END;

      INSERT INTO partner_quest_identity_merge_audit (
        surviving_canonical, merged_canonical, conflict_kind,
        kept_completion_id, removed_snapshot
      ) VALUES (
        p_surviving_canonical, p_merged_canonical, 'duplicate_quest_scope',
        v_existing_id, to_jsonb(v_row) || jsonb_build_object('delivery', to_jsonb(v_loser_delivery))
      );

      IF v_loser_rank > v_kept_rank THEN
        UPDATE api_partner_quest_reward_deliveries SET
          mode = v_loser_delivery.mode,
          status = v_loser_delivery.status,
          base_points = v_loser_delivery.base_points,
          awarded_points = v_loser_delivery.awarded_points,
          destination_wallet = v_loser_delivery.destination_wallet,
          external_ref = v_loser_delivery.external_ref,
          ledger_entry_id = v_loser_delivery.ledger_entry_id,
          attempts = v_loser_delivery.attempts,
          last_error = v_loser_delivery.last_error,
          completed_at = v_loser_delivery.completed_at,
          updated_at = now()
        WHERE completion_id = v_existing_id;
      END IF;

      DELETE FROM api_partner_quest_reward_deliveries WHERE completion_id = v_row.id;
      DELETE FROM api_partner_quest_completions WHERE id = v_row.id;
    END IF;
  END LOOP;

  UPDATE identity_links
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  UPDATE miles_ledger
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  UPDATE hub_user_canonicals
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  IF to_regclass('public.skill_game_sessions') IS NOT NULL THEN
    UPDATE skill_game_sessions
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  IF to_regclass('public.skill_game_server_sessions') IS NOT NULL THEN
    UPDATE skill_game_server_sessions
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  IF to_regclass('public.hub_skill_game_play_reservations') IS NOT NULL THEN
    UPDATE hub_skill_game_play_reservations
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  IF to_regclass('public.skill_game_reward_deliveries') IS NOT NULL THEN
    UPDATE skill_game_reward_deliveries
    SET canonical_id = p_surviving_canonical
    WHERE canonical_id = p_merged_canonical;
  END IF;

  -- leaderboard_profiles.canonical_id is a PRIMARY KEY, so a straight UPDATE
  -- would violate it if the surviving canonical already has a claimed
  -- username — drop the merged row in that case instead of erroring.
  IF to_regclass('public.leaderboard_profiles') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM leaderboard_profiles WHERE canonical_id = p_surviving_canonical) THEN
      DELETE FROM leaderboard_profiles WHERE canonical_id = p_merged_canonical;
    ELSE
      UPDATE leaderboard_profiles
      SET canonical_id = p_surviving_canonical
      WHERE canonical_id = p_merged_canonical;
    END IF;
  END IF;

  INSERT INTO partner_quest_identity_merge_audit (
    surviving_canonical, merged_canonical, conflict_kind
  ) VALUES (p_surviving_canonical, p_merged_canonical, 'canonical_merged');

  RETURN p_surviving_canonical;
END;
$$;

REVOKE ALL ON FUNCTION merge_partner_quest_canonicals(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_partner_quest_canonicals(uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
