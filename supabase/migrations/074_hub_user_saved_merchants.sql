-- Save/follow a merchant (discovery-blueprint.md §6/§8, Phase 2) — schema
-- and API only this pass, no UI yet: a save button only pays off once
-- there's a re-engagement channel that can act on it.
--
-- Follows the same owned-table conventions as hub_user_profiles
-- (049_hub_quest_catalog.sql): hub_ prefix, RLS with a select-own policy,
-- explicit REVOKE/GRANT so only the authenticated owner can read their own
-- rows and only service_role can write. The FK to the externally-owned
-- partners table mirrors the existing precedent already used in
-- 046_hub_miles_spend_intents.sql and 068_skill_game_dormant_prize_schema.sql.

CREATE TABLE IF NOT EXISTS hub_user_saved_merchants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id uuid        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_user_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_saved_merchants_user
  ON hub_user_saved_merchants (hub_user_id, created_at DESC);

ALTER TABLE hub_user_saved_merchants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_user_saved_merchants_select_own"
  ON hub_user_saved_merchants FOR SELECT
  USING (auth.uid() = hub_user_id);

REVOKE ALL ON hub_user_saved_merchants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hub_user_saved_merchants TO authenticated;
GRANT ALL ON hub_user_saved_merchants TO service_role;
