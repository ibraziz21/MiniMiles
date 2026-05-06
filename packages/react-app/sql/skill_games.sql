-- Skill games session log
-- Run once on Supabase: SQL Editor → paste and execute

create table if not exists skill_game_sessions (
  session_id         text        primary key,
  wallet_address     text        not null,
  game_type          text        not null,          -- 'rule_tap' | 'memory_flip'
  score              integer     not null default 0,
  reward_miles       integer     not null default 0,
  reward_stable      numeric(10,6) not null default 0,
  accepted           boolean     not null default false,
  anti_abuse_flags   text[]      not null default '{}',
  -- bytes32 hex from on-chain GameStarted event; used to verify replay seed integrity
  seed_commitment    text,
  -- set once the settleGame() tx is confirmed; NULL means not yet settled on-chain
  settle_tx_hash     text,
  created_at         timestamptz not null default now()
);

-- Migration: add columns to existing tables (safe to run on already-created tables)
alter table skill_game_sessions
  add column if not exists seed_commitment text,
  add column if not exists settle_tx_hash  text;

-- Index for the daily cap query  (wallet + game_type + date range)
create index if not exists skill_game_sessions_wallet_game_date
  on skill_game_sessions (wallet_address, game_type, created_at);

-- Index for leaderboard query (settled sessions only)
create index if not exists skill_game_sessions_settled
  on skill_game_sessions (game_type, accepted, settle_tx_hash, created_at);

-- Row-level security: only the service key can write; anon reads are blocked
alter table skill_game_sessions enable row level security;

-- Service role (backend) can do everything
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'skill_game_sessions' and policyname = 'service_role_all'
  ) then
    execute 'create policy "service_role_all" on skill_game_sessions for all using (auth.role() = ''service_role'')';
  end if;
end $$;
