-- 070_skill_game_mastery_economy.sql
-- Mastery economy v1 — Slice 1 (economy foundation) of
-- skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md §3.2.
--
-- Purely additive: these two tables are shadow/comparison state only in
-- this slice. Nothing in the live reward path
-- (finalize_hub_skill_game_session, 064_hub_skill_game_reward_delivery.sql)
-- reads or writes them yet, and the legacy 6/9/12 economy is unchanged.
-- Wiring an atomic finalize against this schema is Slice 2 ("Economy
-- cutover", §3.3) — a locked transaction, not a read-then-credit sequence.

CREATE TABLE IF NOT EXISTS public.skill_game_mastery_days (
  owner_key           text NOT NULL,
  game_type           text NOT NULL,
  local_date          date NOT NULL,
  economy_version     text NOT NULL,
  attempts_started    integer NOT NULL DEFAULT 0,
  best_score          integer,
  best_tier           text NOT NULL DEFAULT 'none'
                        CHECK (best_tier IN ('none', 'moderate', 'strong', 'elite')),
  base_miles_entitled integer NOT NULL DEFAULT 0,
  base_miles_credited integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_key, game_type, local_date, economy_version)
);

CREATE INDEX IF NOT EXISTS idx_skill_game_mastery_days_updated
  ON public.skill_game_mastery_days (updated_at);

ALTER TABLE public.skill_game_mastery_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.skill_game_mastery_days FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.skill_game_mastery_days TO service_role;

CREATE TABLE IF NOT EXISTS public.skill_game_monthly_caps (
  owner_key           text NOT NULL,
  local_month         date NOT NULL,
  economy_version     text NOT NULL,
  base_miles_credited integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_key, local_month, economy_version)
);

CREATE INDEX IF NOT EXISTS idx_skill_game_monthly_caps_updated
  ON public.skill_game_monthly_caps (updated_at);

ALTER TABLE public.skill_game_monthly_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.skill_game_monthly_caps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.skill_game_monthly_caps TO service_role;

DROP TRIGGER IF EXISTS trg_sgmd_touch_updated_at ON public.skill_game_mastery_days;
CREATE TRIGGER trg_sgmd_touch_updated_at
  BEFORE UPDATE ON public.skill_game_mastery_days
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_sgmc_touch_updated_at ON public.skill_game_monthly_caps;
CREATE TRIGGER trg_sgmc_touch_updated_at
  BEFORE UPDATE ON public.skill_game_monthly_caps
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

NOTIFY pgrst, 'reload schema';
