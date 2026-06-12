-- Penalty Pressure columns on the shared server session store.
--
-- Run AFTER skill_games_server_auth.sql and skill_games_server_auth_rule_tap.sql.
-- Penalty Pressure reuses server_seed, started_at_ms, finalized, score, version,
-- and completed; adds shot-specific state below.

alter table public.skill_game_server_sessions
  add column if not exists shots_taken    integer not null default 0,
  add column if not exists goals_scored   integer not null default 0,
  add column if not exists pp_streak      integer not null default 0,
  add column if not exists total_score    integer not null default 0,
  add column if not exists column_history jsonb   not null default '[]'::jsonb,
  add column if not exists shot_results   jsonb   not null default '[]'::jsonb;

create index if not exists skill_game_server_sessions_penalty_wallet_idx
  on public.skill_game_server_sessions (wallet_address)
  where game_type = 'penalty_pressure';
