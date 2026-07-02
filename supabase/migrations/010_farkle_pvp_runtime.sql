-- PvP Farkle runtime schema.
-- This migration defines the catalog, matchmaking, match state, balances,
-- ledger, and Game Nights registration tables used by the React Farkle routes
-- and the backend Farkle settlement service.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Game catalog ---------------------------------------------------------------

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  game_key    text not null unique,
  name        text not null,
  status      text not null default 'active'
                check (status in ('active', 'paused', 'retired')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.game_modes (
  id                    uuid primary key default gen_random_uuid(),
  game_id               uuid not null references public.games(id),
  mode_key              text not null unique,
  display_name          text not null,
  target_score          integer not null,
  entry_currency        text not null,
  entry_amount          integer not null default 1,
  winner_miles_reward   integer not null default 10,
  loser_miles_reward    integer not null default 5,
  winner_reward_credit  integer not null default 0,
  active                boolean not null default true,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Live-schema compatibility --------------------------------------------------
-- Some live databases already have public.games from an older app version with
-- only id/game_key/name/status/created_at. CREATE TABLE IF NOT EXISTS skips the
-- column definitions above, so add the columns the Farkle catalog writes before
-- touching the existing row.

alter table if exists public.games
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.game_modes
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists game_id uuid,
  add column if not exists mode_key text,
  add column if not exists display_name text,
  add column if not exists target_score integer not null default 1500,
  add column if not exists entry_currency text,
  add column if not exists entry_amount integer not null default 1,
  add column if not exists winner_miles_reward integer not null default 10,
  add column if not exists loser_miles_reward integer not null default 5,
  add column if not exists winner_reward_credit integer not null default 0,
  add column if not exists active boolean not null default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

with existing_farkle as (
  select id
  from public.games
  where lower(game_key) = 'farkle'
  order by case when game_key = 'farkle' then 0 else 1 end, created_at asc
  limit 1
),
updated_farkle as (
  update public.games g
  set game_key = 'farkle',
      name = 'PvP Farkle',
      status = 'active',
      metadata = coalesce(g.metadata, '{}'::jsonb) || '{"source":"akiba_test"}'::jsonb,
      updated_at = now()
  where g.id = (select id from existing_farkle)
  returning g.id
)
insert into public.games (game_key, name, status, metadata)
select 'farkle', 'PvP Farkle', 'active', '{"source":"akiba_test"}'::jsonb
where not exists (select 1 from updated_farkle)
on conflict (game_key) do update
set name = excluded.name,
    status = excluded.status,
    metadata = coalesce(public.games.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with farkle_game as (
  select id
  from public.games
  where lower(game_key) = 'farkle'
  order by case when game_key = 'farkle' then 0 else 1 end, created_at asc
  limit 1
),
desired_modes as (
  select
    g.id as game_id,
    mode_key,
    display_name,
    target_score,
    entry_currency,
    entry_amount,
    winner_miles_reward,
    loser_miles_reward,
    winner_reward_credit
  from farkle_game g
  cross join (
    values
      ('FARKLE_QUICK_1500_AKIBA', 'Quick Duel', 1500, 'AKIBA_TICKET', 1, 10, 5, 0),
      ('FARKLE_REWARD_3000_USDT', 'Reward Duel', 2500, 'GAME_CREDIT', 1, 10, 5, 15)
  ) as m(
    mode_key,
    display_name,
    target_score,
    entry_currency,
    entry_amount,
    winner_miles_reward,
    loser_miles_reward,
    winner_reward_credit
  )
),
updated_modes as (
  update public.game_modes gm
  set game_id = d.game_id,
      display_name = d.display_name,
      target_score = d.target_score,
      entry_currency = d.entry_currency,
      entry_amount = d.entry_amount,
      winner_miles_reward = d.winner_miles_reward,
      loser_miles_reward = d.loser_miles_reward,
      winner_reward_credit = d.winner_reward_credit,
      active = true,
      updated_at = now()
  from desired_modes d
  where gm.mode_key = d.mode_key
  returning gm.mode_key
)
insert into public.game_modes (
  game_id,
  mode_key,
  display_name,
  target_score,
  entry_currency,
  entry_amount,
  winner_miles_reward,
  loser_miles_reward,
  winner_reward_credit,
  active
)
select
  d.game_id,
  d.mode_key,
  d.display_name,
  d.target_score,
  d.entry_currency,
  d.entry_amount,
  d.winner_miles_reward,
  d.loser_miles_reward,
  d.winner_reward_credit,
  true
from desired_modes d
where not exists (
  select 1 from updated_modes u where u.mode_key = d.mode_key
);

-- Matchmaking and match state ------------------------------------------------

create table if not exists public.game_matches (
  id                    uuid primary key default gen_random_uuid(),
  match_key             text unique,
  game_id               uuid references public.games(id),
  mode_id               uuid references public.game_modes(id),
  chain_id              integer not null default 42220,
  status                text not null default 'created'
                          check (status in ('created', 'funded', 'in_progress', 'completed', 'cancelled')),
  seed_hash             text,
  revealed_seed         text,
  current_turn_address  text,
  turn_number           integer not null default 1,
  winner_address        text,
  loser_address         text,
  winner_score          integer,
  loser_score           integer,
  replay_hash           text,
  result_hash           text,
  metadata              jsonb not null default '{}'::jsonb,
  started_at            timestamptz,
  turn_started_at       timestamptz,
  last_action_at        timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.game_match_players (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.game_matches(id) on delete cascade,
  wallet_address  text not null,
  seat_index      integer not null,
  banked_score    integer not null default 0,
  result          text check (result in ('win', 'loss', 'draw')),
  entry_debited   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (match_id, wallet_address),
  unique (match_id, seat_index)
);

create table if not exists public.matchmaking_queue (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,
  mode_key        text not null,
  status          text not null default 'waiting'
                    check (status in ('waiting', 'matched', 'expired', 'cancelled')),
  match_id        uuid references public.game_matches(id) on delete set null,
  queued_at       timestamptz not null default now(),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (wallet_address, mode_key)
);

create table if not exists public.farkle_turns (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.game_matches(id) on delete cascade,
  wallet_address  text not null,
  turn_number     integer not null,
  roll_number     integer not null,
  dice_values     jsonb not null,
  selected_dice   jsonb not null default '[]'::jsonb,
  turn_points     integer not null default 0,
  banked_points   integer not null default 0,
  action          text not null
                    check (action in ('roll', 'roll_again', 'bank', 'farkle')),
  farkled         boolean not null default false,
  hot_dice        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (match_id, wallet_address, turn_number, roll_number)
);

-- Farkle balances and ledger -------------------------------------------------

create table if not exists public.farkle_ticket_balances (
  wallet_address  text primary key,
  balance         integer not null default 0 check (balance >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.farkle_credit_balances (
  wallet_address        text primary key,
  purchased_credits     integer not null default 0 check (purchased_credits >= 0),
  reward_credits_cents  integer not null default 0 check (reward_credits_cents >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.game_credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,
  amount          integer not null,
  balance_after   integer,
  currency        text not null,
  ledger_type     text not null,
  tx_hash         text,
  reference_type  text,
  reference_id    text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- Game Nights registration ---------------------------------------------------

create table if not exists public.farkle_game_night_weeks (
  id                      text primary key,
  title                   text not null default 'Akiba Game Nights',
  status                  text not null default 'registration_open',
  qualification_starts_at timestamptz not null,
  qualification_ends_at   timestamptz not null,
  registration_cap        integer not null default 40,
  required_games          integer not null default 20,
  bracket_size            integer not null default 16,
  prize_pool_cents        integer not null default 2000,
  winner_prize_cents      integer not null default 1500,
  runner_up_prize_cents   integer not null default 500,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists public.farkle_game_night_registrations (
  id                            uuid primary key default gen_random_uuid(),
  week_id                       text not null references public.farkle_game_night_weeks(id),
  wallet_address                text not null,
  status                        text not null
                                  check (status in ('registered', 'waitlisted', 'cancelled')),
  games_played_at_registration  integer not null,
  registered_at                 timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (week_id, wallet_address)
);

-- Live runtime-table compatibility ------------------------------------------
-- Existing live tables may have been created by earlier prototypes. Add every
-- column used by the indexes, triggers, API routes, and backend settlement code
-- before the rest of this migration touches those tables.

alter table if exists public.game_matches
  add column if not exists match_key text,
  add column if not exists game_id uuid,
  add column if not exists mode_id uuid,
  add column if not exists chain_id integer not null default 42220,
  add column if not exists status text not null default 'created',
  add column if not exists seed_hash text,
  add column if not exists revealed_seed text,
  add column if not exists current_turn_address text,
  add column if not exists turn_number integer not null default 1,
  add column if not exists winner_address text,
  add column if not exists loser_address text,
  add column if not exists winner_score integer,
  add column if not exists loser_score integer,
  add column if not exists replay_hash text,
  add column if not exists result_hash text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists turn_started_at timestamptz,
  add column if not exists last_action_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.game_match_players
  add column if not exists match_id uuid,
  add column if not exists wallet_address text,
  add column if not exists seat_index integer,
  add column if not exists banked_score integer not null default 0,
  add column if not exists result text,
  add column if not exists entry_debited boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.matchmaking_queue
  add column if not exists wallet_address text,
  add column if not exists mode_key text,
  add column if not exists status text not null default 'waiting',
  add column if not exists match_id uuid,
  add column if not exists queued_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.farkle_turns
  add column if not exists match_id uuid,
  add column if not exists wallet_address text,
  add column if not exists turn_number integer,
  add column if not exists roll_number integer,
  add column if not exists dice_values jsonb not null default '[]'::jsonb,
  add column if not exists selected_dice jsonb not null default '[]'::jsonb,
  add column if not exists turn_points integer not null default 0,
  add column if not exists banked_points integer not null default 0,
  add column if not exists action text not null default 'roll',
  add column if not exists farkled boolean not null default false,
  add column if not exists hot_dice boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.farkle_ticket_balances
  add column if not exists wallet_address text,
  add column if not exists balance integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.farkle_credit_balances
  add column if not exists wallet_address text,
  add column if not exists purchased_credits integer not null default 0,
  add column if not exists reward_credits_cents integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.game_credit_ledger
  add column if not exists wallet_address text,
  add column if not exists amount integer not null default 0,
  add column if not exists balance_after integer,
  add column if not exists currency text,
  add column if not exists ledger_type text,
  add column if not exists tx_hash text,
  add column if not exists reference_type text,
  add column if not exists reference_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.farkle_game_night_weeks
  add column if not exists title text not null default 'Akiba Game Nights',
  add column if not exists status text not null default 'registration_open',
  add column if not exists qualification_starts_at timestamptz not null default now(),
  add column if not exists qualification_ends_at timestamptz not null default now(),
  add column if not exists registration_cap integer not null default 40,
  add column if not exists required_games integer not null default 20,
  add column if not exists bracket_size integer not null default 16,
  add column if not exists prize_pool_cents integer not null default 2000,
  add column if not exists winner_prize_cents integer not null default 1500,
  add column if not exists runner_up_prize_cents integer not null default 500,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.farkle_game_night_registrations
  add column if not exists week_id text,
  add column if not exists wallet_address text,
  add column if not exists status text not null default 'registered',
  add column if not exists games_played_at_registration integer not null default 0,
  add column if not exists registered_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Indexes --------------------------------------------------------------------

create index if not exists game_matches_status_idx
  on public.game_matches (status, created_at desc);

create index if not exists game_matches_player_winner_idx
  on public.game_matches (winner_address);

create index if not exists game_matches_player_loser_idx
  on public.game_matches (loser_address);

create index if not exists game_match_players_wallet_idx
  on public.game_match_players (wallet_address);

create index if not exists game_match_players_match_idx
  on public.game_match_players (match_id);

create index if not exists matchmaking_queue_mode_status_idx
  on public.matchmaking_queue (mode_key, status, queued_at);

create index if not exists matchmaking_queue_expiry_idx
  on public.matchmaking_queue (status, expires_at);

create index if not exists farkle_turns_match_turn_idx
  on public.farkle_turns (match_id, turn_number, roll_number);

create index if not exists game_credit_ledger_wallet_idx
  on public.game_credit_ledger (wallet_address, created_at desc);

create index if not exists game_credit_ledger_reference_idx
  on public.game_credit_ledger (reference_type, reference_id);

create unique index if not exists game_credit_ledger_purchase_tx_unique
  on public.game_credit_ledger (ledger_type, tx_hash)
  where tx_hash is not null
    and ledger_type in (
      'AKIBA_TICKET_PURCHASED',
      'GAME_CREDIT_PURCHASED',
      'REWARD_CREDIT_CLAIMED'
    );

create index if not exists farkle_gn_weeks_status
  on public.farkle_game_night_weeks (status);

create index if not exists farkle_gn_reg_week
  on public.farkle_game_night_registrations (week_id);

create index if not exists farkle_gn_reg_wallet
  on public.farkle_game_night_registrations (wallet_address);

create index if not exists farkle_gn_reg_week_status
  on public.farkle_game_night_registrations (week_id, status);

-- Updated-at triggers --------------------------------------------------------

drop trigger if exists games_touch_updated_at on public.games;
create trigger games_touch_updated_at
  before update on public.games
  for each row execute function public.touch_updated_at();

drop trigger if exists game_modes_touch_updated_at on public.game_modes;
create trigger game_modes_touch_updated_at
  before update on public.game_modes
  for each row execute function public.touch_updated_at();

drop trigger if exists game_matches_touch_updated_at on public.game_matches;
create trigger game_matches_touch_updated_at
  before update on public.game_matches
  for each row execute function public.touch_updated_at();

drop trigger if exists game_match_players_touch_updated_at on public.game_match_players;
create trigger game_match_players_touch_updated_at
  before update on public.game_match_players
  for each row execute function public.touch_updated_at();

drop trigger if exists matchmaking_queue_touch_updated_at on public.matchmaking_queue;
create trigger matchmaking_queue_touch_updated_at
  before update on public.matchmaking_queue
  for each row execute function public.touch_updated_at();

drop trigger if exists farkle_ticket_balances_touch_updated_at on public.farkle_ticket_balances;
create trigger farkle_ticket_balances_touch_updated_at
  before update on public.farkle_ticket_balances
  for each row execute function public.touch_updated_at();

drop trigger if exists farkle_credit_balances_touch_updated_at on public.farkle_credit_balances;
create trigger farkle_credit_balances_touch_updated_at
  before update on public.farkle_credit_balances
  for each row execute function public.touch_updated_at();

drop trigger if exists farkle_gn_weeks_touch_updated_at on public.farkle_game_night_weeks;
create trigger farkle_gn_weeks_touch_updated_at
  before update on public.farkle_game_night_weeks
  for each row execute function public.touch_updated_at();

drop trigger if exists farkle_gn_registrations_touch_updated_at on public.farkle_game_night_registrations;
create trigger farkle_gn_registrations_touch_updated_at
  before update on public.farkle_game_night_registrations
  for each row execute function public.touch_updated_at();

-- RLS ------------------------------------------------------------------------
-- All game writes happen through server routes with the service role key.

alter table public.games enable row level security;
alter table public.game_modes enable row level security;
alter table public.game_matches enable row level security;
alter table public.game_match_players enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.farkle_turns enable row level security;
alter table public.farkle_ticket_balances enable row level security;
alter table public.farkle_credit_balances enable row level security;
alter table public.game_credit_ledger enable row level security;
alter table public.farkle_game_night_weeks enable row level security;
alter table public.farkle_game_night_registrations enable row level security;

drop policy if exists service_role_all on public.games;
create policy service_role_all on public.games
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.game_modes;
create policy service_role_all on public.game_modes
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.game_matches;
create policy service_role_all on public.game_matches
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.game_match_players;
create policy service_role_all on public.game_match_players
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.matchmaking_queue;
create policy service_role_all on public.matchmaking_queue
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.farkle_turns;
create policy service_role_all on public.farkle_turns
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.farkle_ticket_balances;
create policy service_role_all on public.farkle_ticket_balances
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.farkle_credit_balances;
create policy service_role_all on public.farkle_credit_balances
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.game_credit_ledger;
create policy service_role_all on public.game_credit_ledger
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.farkle_game_night_weeks;
create policy service_role_all on public.farkle_game_night_weeks
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists service_role_all on public.farkle_game_night_registrations;
create policy service_role_all on public.farkle_game_night_registrations
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
