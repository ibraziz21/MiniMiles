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
  created_at         timestamptz not null default now()
);

-- Index for the daily cap query  (wallet + game_type + date range)
create index if not exists skill_game_sessions_wallet_game_date
  on skill_game_sessions (wallet_address, game_type, created_at);

-- Row-level security: only the service key can write; anon reads are blocked
alter table skill_game_sessions enable row level security;

-- Service role (backend) can do everything
create policy "service_role_all" on skill_game_sessions
  for all using (auth.role() = 'service_role');
