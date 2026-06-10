-- Rule Tap server-authoritative columns on the shared session store.
--
-- Run AFTER skill_games_server_auth.sql. Rule Tap reuses the existing row
-- (server_seed, started_at_ms, mistakes, action_offsets, score, finalized,
-- version, completed) and adds its own secret + dedup state below. The `deck`
-- column is inserted as '[]' for rule_tap rows.

alter table public.skill_game_server_sessions
  add column if not exists rule jsonb,
  add column if not exists timeline jsonb,           -- secret; never sent to the client whole
  add column if not exists counted_targets jsonb not null default '[]'::jsonb,
  add column if not exists correct integer not null default 0,
  add column if not exists taps integer not null default 0;
