-- =============================================================
-- AkibaMiles Multiplayer Game Framework + Farkle Duel
-- Run in Supabase SQL editor
-- Convention: wallet_address text (matches existing codebase)
-- =============================================================

-- ── 1. Games registry ─────────────────────────────────────────
create table if not exists games (
  id         uuid primary key default gen_random_uuid(),
  game_key   text unique not null,
  name       text not null,
  status     text not null default 'active' check (status in ('active','inactive','maintenance')),
  created_at timestamptz default now()
);

-- ── 2. Game modes ─────────────────────────────────────────────
create table if not exists game_modes (
  id                        uuid primary key default gen_random_uuid(),
  game_id                   uuid references games(id) on delete cascade,
  mode_key                  text unique not null,
  name                      text not null,
  target_score              integer,
  player_count              integer not null default 2,
  entry_type                text not null check (entry_type in ('AKIBA_TICKET','GAME_CREDIT','USDT','NONE')),
  entry_amount              numeric not null default 1,
  winner_miles_reward       numeric default 0,
  loser_miles_reward        numeric default 0,
  winner_reward_credit      numeric default 0,
  max_rewarded_per_day      integer default 5,
  max_same_opponent_per_day integer default 1,
  status                    text not null default 'active' check (status in ('active','inactive')),
  config                    jsonb default '{}',
  created_at                timestamptz default now()
);

-- ── 3. Farkle ticket balances ─────────────────────────────────
create table if not exists farkle_ticket_balances (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null unique,
  balance         integer not null default 0 check (balance >= 0),
  updated_at      timestamptz default now()
);

-- ── 4. Farkle credit balances ─────────────────────────────────
create table if not exists farkle_credit_balances (
  id                   uuid primary key default gen_random_uuid(),
  wallet_address       text not null unique,
  purchased_credits    integer not null default 0 check (purchased_credits >= 0),
  reward_credits_cents integer not null default 0 check (reward_credits_cents >= 0),
  updated_at           timestamptz default now()
);

-- ── 5. Matches ────────────────────────────────────────────────
create table if not exists game_matches (
  id                     uuid primary key default gen_random_uuid(),
  match_key              text unique not null,
  game_id                uuid references games(id),
  mode_id                uuid references game_modes(id),
  status                 text not null default 'created'
                           check (status in ('created','waiting','funded','in_progress','completed','settled','cancelled','disputed')),
  current_turn_address   text,
  turn_number            integer default 1,
  seed_hash              text,
  metadata               jsonb default '{}',
  winner_address         text,
  loser_address          text,
  winner_score           integer,
  loser_score            integer,
  replay_hash            text,
  result_hash            text,
  revealed_seed          text,
  started_at             timestamptz,
  completed_at           timestamptz,
  settled_at             timestamptz,
  settlement_tx_hash     text,
  created_at             timestamptz default now()
);

-- ── 6. Match players ──────────────────────────────────────────
create table if not exists game_match_players (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid references game_matches(id) on delete cascade,
  wallet_address  text not null,
  seat_index      integer not null,
  banked_score    integer default 0,
  result          text check (result in ('win','loss','draw',null)),
  entry_debited   boolean default false,
  reward_granted  boolean default false,
  joined_at       timestamptz default now(),
  unique(match_id, wallet_address),
  unique(match_id, seat_index)
);

-- ── 7. Farkle turns ───────────────────────────────────────────
create table if not exists farkle_turns (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid references game_matches(id) on delete cascade,
  wallet_address  text not null,
  turn_number     integer not null,
  roll_number     integer not null,
  dice_values     integer[] not null,
  selected_dice   integer[] default '{}',
  turn_points     integer default 0,
  banked_points   integer default 0,
  action          text not null check (action in ('roll','bank','forfeit','hot_dice')),
  farkled         boolean default false,
  hot_dice        boolean default false,
  created_at      timestamptz default now()
);

-- ── 8. Credit / ticket ledger ─────────────────────────────────
create table if not exists game_credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,
  amount          numeric not null,
  balance_after   numeric,
  currency        text not null check (currency in ('AKIBA_TICKET','GAME_CREDIT','REWARD_CREDIT','AKIBAMILES','USDT')),
  ledger_type     text not null check (ledger_type in (
    'AKIBA_TICKET_PURCHASED','AKIBA_TICKET_DEBITED',
    'GAME_CREDIT_PURCHASED','GAME_CREDIT_DEBITED',
    'REWARD_CREDIT_GRANTED','REWARD_CREDIT_CLAIMED',
    'AKIBAMILES_REWARD_GRANTED','MATCH_REFUND',
    'ADMIN_ADJUSTMENT','FRAUD_REVERSAL'
  )),
  reference_type  text,
  reference_id    uuid,
  tx_hash         text,
  metadata        jsonb default '{}',
  created_at      timestamptz default now()
);

-- ── 9. Daily limits ───────────────────────────────────────────
create table if not exists game_daily_limits (
  id                    uuid primary key default gen_random_uuid(),
  wallet_address        text not null,
  mode_key              text not null,
  date                  date not null,
  rewarded_matches      integer default 0,
  reward_wins           integer default 0,
  reward_credit_earned  numeric default 0,
  akibamiles_earned     numeric default 0,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique(wallet_address, mode_key, date)
);

-- ── 10. Matchmaking queue ─────────────────────────────────────
create table if not exists matchmaking_queue (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,
  mode_key        text not null,
  status          text not null default 'waiting'
                    check (status in ('waiting','matched','cancelled','expired')),
  match_id        uuid references game_matches(id),
  queued_at       timestamptz default now(),
  expires_at      timestamptz default (now() + interval '2 minutes'),
  unique(wallet_address, mode_key)
);

-- ── 11. Player stats ──────────────────────────────────────────
create table if not exists farkle_player_stats (
  id                          uuid primary key default gen_random_uuid(),
  wallet_address              text not null,
  mode_key                    text not null,
  matches_played              integer default 0,
  wins                        integer default 0,
  losses                      integer default 0,
  current_win_streak          integer default 0,
  best_win_streak             integer default 0,
  total_akibamiles_earned     numeric default 0,
  total_reward_credits_earned numeric default 0,
  highest_score               integer default 0,
  updated_at                  timestamptz default now(),
  unique(wallet_address, mode_key)
);

-- ── Seed data ─────────────────────────────────────────────────
insert into games (game_key, name, status)
  values ('FARKLE', 'Farkle Duel', 'active')
  on conflict (game_key) do nothing;

insert into game_modes (
  game_id, mode_key, name, target_score, player_count,
  entry_type, entry_amount,
  winner_miles_reward, loser_miles_reward, winner_reward_credit,
  max_rewarded_per_day, max_same_opponent_per_day, config
) values
(
  (select id from games where game_key = 'FARKLE'),
  'FARKLE_QUICK_1500_AKIBA', 'Farkle Quick Duel',
  1500, 2, 'AKIBA_TICKET', 1, 10, 5, 0, 5, 1,
  '{"ticketPack":{"tickets":5,"akibaMilesCost":25}}'::jsonb
),
(
  (select id from games where game_key = 'FARKLE'),
  'FARKLE_REWARD_3000_USDT', 'Farkle Reward Duel',
  2500, 2, 'GAME_CREDIT', 1, 10, 5, 15, 10, 1,
  '{"creditPack":{"credits":5,"usdtCostCents":50}}'::jsonb
)
on conflict (mode_key) do nothing;

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_game_matches_status    on game_matches (status);
create index if not exists idx_game_matches_mode      on game_matches (mode_id, status);
create index if not exists idx_match_players_wallet   on game_match_players (wallet_address);
create index if not exists idx_match_players_match    on game_match_players (match_id);
create index if not exists idx_farkle_turns_match     on farkle_turns (match_id, turn_number, roll_number);
create index if not exists idx_farkle_turns_wallet    on farkle_turns (wallet_address, match_id);
create index if not exists idx_ledger_wallet          on game_credit_ledger (wallet_address, created_at desc);
create index if not exists idx_daily_limits_lookup    on game_daily_limits (wallet_address, mode_key, date);
create index if not exists idx_mmqueue_mode_status    on matchmaking_queue (mode_key, status, queued_at);
