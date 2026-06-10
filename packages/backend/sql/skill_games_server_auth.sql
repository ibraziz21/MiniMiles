-- Skill-games hardening migration.
--
-- 1) Cross-instance settlement lease column (used by tryClaimSettlement in
--    games/routes.ts). Until this column exists the lock fails OPEN, so applying
--    this migration is what actually activates the multi-instance safety.
--
-- 2) Server-authoritative Memory Flip session store. The shuffled deck and all
--    play state live here, server-side only. The client never receives unflipped
--    cards, so knowing the seed/commitment gives a cheater nothing.

-- 1) Settlement lease ------------------------------------------------------
alter table public.skill_game_sessions
  add column if not exists settle_claimed_at timestamptz;

-- 2) Server-authoritative Memory Flip --------------------------------------
create table if not exists public.skill_game_server_sessions (
  session_id       text primary key,
  wallet_address   text not null,
  game_type        text not null,
  server_seed      text not null,            -- revealed to the client only at finish
  server_seed_hash text not null,            -- published at init for provable fairness
  deck             jsonb not null,           -- shuffled card values, server-only
  revealed         jsonb not null default '[]'::jsonb,
  matched          jsonb not null default '[]'::jsonb,
  selected         jsonb not null default '[]'::jsonb,
  action_offsets   jsonb not null default '[]'::jsonb, -- server-observed flip times
  moves            integer not null default 0,
  matches          integer not null default 0,
  mistakes         integer not null default 0,
  lock_until_ms    integer not null default 0,
  started_at_ms    bigint not null,          -- server epoch ms at session creation
  completed        boolean not null default false,
  finalized        boolean not null default false,
  score            integer,
  version          integer not null default 0, -- optimistic-concurrency guard
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint skill_game_server_sessions_wallet_hex
    check (wallet_address ~ '^0x[0-9a-fA-F]{40}$')
);

create index if not exists skill_game_server_sessions_wallet_idx
  on public.skill_game_server_sessions (wallet_address);

create index if not exists skill_game_server_sessions_unfinalized_idx
  on public.skill_game_server_sessions (finalized)
  where finalized = false;
