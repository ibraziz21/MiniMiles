-- CrackPot runtime schema.
-- Promotes the backend CrackPot SQL into the Supabase migration chain and
-- includes the queued paid-attempt fields used by the migrated React routes.

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

create table if not exists public.crackpot_cycles (
  id              uuid primary key default gen_random_uuid(),
  version         text not null default 'miles'
                    check (version in ('miles', 'usdt')),
  theme           text not null,
  secret_code     jsonb not null,
  entropy_source  text not null,
  status          text not null default 'active'
                    check (status in ('active', 'cracked', 'dead')),
  pot_balance     integer not null default 200,
  pot_cap         integer not null default 10000,
  seed_amount     integer not null default 200,
  expires_at      timestamptz not null,
  winner_address  text,
  winner_guesses  integer,
  winner_tx_hash  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.crackpot_attempts (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references public.crackpot_cycles(id),
  player_address   text not null,
  attempt_number   integer not null,
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  status           text not null default 'active',
  guesses_used     integer not null default 0,
  is_paid          boolean not null default false,
  entry_tx_hash    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crackpot_attempts_one_active_per_player_cycle
    unique (cycle_id, player_address, attempt_number)
);

alter table public.crackpot_attempts
  add column if not exists entry_tx_hash text;

alter table public.crackpot_attempts
  drop constraint if exists crackpot_attempts_status_check;

alter table public.crackpot_attempts
  add constraint crackpot_attempts_status_check
  check (status in ('active', 'queued', 'expired', 'won', 'lost'));

create table if not exists public.crackpot_guesses (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null references public.crackpot_attempts(id),
  cycle_id         uuid not null references public.crackpot_cycles(id),
  player_address   text not null,
  guess_number     integer not null,
  symbols          jsonb not null,
  feedback         jsonb not null,
  locked_count     integer not null,
  is_correct       boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint crackpot_guesses_unique_per_attempt
    unique (attempt_id, guess_number)
);

create index if not exists crackpot_cycles_status_idx
  on public.crackpot_cycles (status, expires_at);

create unique index if not exists crackpot_cycles_one_active_per_version
  on public.crackpot_cycles (version, status)
  where status = 'active';

create index if not exists crackpot_attempts_player_cycle_idx
  on public.crackpot_attempts (player_address, cycle_id);

create index if not exists crackpot_attempts_cycle_active_idx
  on public.crackpot_attempts (cycle_id, status)
  where status = 'active';

create index if not exists crackpot_attempts_entry_tx_idx
  on public.crackpot_attempts (cycle_id, player_address, entry_tx_hash)
  where entry_tx_hash is not null;

create index if not exists crackpot_guesses_attempt_idx
  on public.crackpot_guesses (attempt_id, guess_number);

create index if not exists crackpot_guesses_cycle_player_idx
  on public.crackpot_guesses (cycle_id, player_address);

drop trigger if exists crackpot_cycles_touch_updated_at on public.crackpot_cycles;
create trigger crackpot_cycles_touch_updated_at
  before update on public.crackpot_cycles
  for each row execute function public.touch_updated_at();

drop trigger if exists crackpot_attempts_touch_updated_at on public.crackpot_attempts;
create trigger crackpot_attempts_touch_updated_at
  before update on public.crackpot_attempts
  for each row execute function public.touch_updated_at();

alter table public.crackpot_cycles enable row level security;
alter table public.crackpot_attempts enable row level security;
alter table public.crackpot_guesses enable row level security;

drop policy if exists crackpot_cycles_deny_all on public.crackpot_cycles;
create policy crackpot_cycles_deny_all on public.crackpot_cycles
  for all using (false);

drop policy if exists crackpot_attempts_deny_all on public.crackpot_attempts;
create policy crackpot_attempts_deny_all on public.crackpot_attempts
  for all using (false);

drop policy if exists crackpot_guesses_deny_all on public.crackpot_guesses;
create policy crackpot_guesses_deny_all on public.crackpot_guesses
  for all using (false);
