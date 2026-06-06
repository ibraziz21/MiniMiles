-- CrackPot game tables
--
-- secret_code is a JSON array of 4 integers (0–5), stored server-side only.
-- It is NEVER returned in any API response. Feedback is computed and
-- noise-injected server-side before being stored and returned to the client.

-- ── Cycles ───────────────────────────────────────────────────────

create table if not exists public.crackpot_cycles (
  id              uuid primary key default gen_random_uuid(),
  version         text not null default 'miles'
                    check (version in ('miles', 'usdt')),
  theme           text not null,
  secret_code     jsonb not null,           -- [i,j,k,l] indices 0–5, never sent to client
  entropy_source  text not null,            -- e.g. BTC block hash used in seed
  status          text not null default 'active'
                    check (status in ('active', 'cracked', 'dead')),
  -- Version A: Miles integer. Version B: USD cents integer (e.g. 200 = $2.00)
  pot_balance     integer not null default 200,
  pot_cap         integer not null default 10000,
  seed_amount     integer not null default 200,
  expires_at      timestamptz not null,
  winner_address  text,
  winner_guesses  integer,                  -- total guesses used by winner
  winner_tx_hash  text,                     -- on-chain tx hash for USDT payout
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists crackpot_cycles_status_idx
  on public.crackpot_cycles (status, expires_at);

-- One active cycle per version at a time
create unique index if not exists crackpot_cycles_one_active_per_version
  on public.crackpot_cycles (version, status)
  where status = 'active';

-- ── Attempts ─────────────────────────────────────────────────────

create table if not exists public.crackpot_attempts (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid not null references public.crackpot_cycles(id),
  player_address   text not null,
  attempt_number   integer not null,        -- 1-indexed per player per cycle
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null,    -- started_at + 120s, enforced server-side
  status           text not null default 'active'
                     check (status in ('active', 'expired', 'won', 'lost')),
  guesses_used     integer not null default 0,
  is_paid          boolean not null default false,  -- true for attempts 4+
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Each player can only have one active attempt at a time per cycle
  constraint crackpot_attempts_one_active_per_player_cycle
    unique (cycle_id, player_address, attempt_number)
);

create index if not exists crackpot_attempts_player_cycle_idx
  on public.crackpot_attempts (player_address, cycle_id);

create index if not exists crackpot_attempts_cycle_active_idx
  on public.crackpot_attempts (cycle_id, status)
  where status = 'active';

-- ── Guesses ──────────────────────────────────────────────────────

create table if not exists public.crackpot_guesses (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null references public.crackpot_attempts(id),
  cycle_id         uuid not null references public.crackpot_cycles(id),
  player_address   text not null,
  guess_number     integer not null,        -- 1-indexed within the attempt
  -- 4-element arrays of symbol indices (0–5)
  symbols          jsonb not null,          -- [i,j,k,l]
  -- Noisy feedback as returned to player (not ground truth)
  -- "locked" | "close" | "miss" per position
  feedback         jsonb not null,          -- ["locked","miss","close","locked"]
  locked_count     integer not null,        -- cached count of locked positions
  is_correct       boolean not null default false,
  created_at       timestamptz not null default now(),
  -- Rate limiting: one guess per 15s per attempt (enforced server-side, indexed here for audit)
  constraint crackpot_guesses_unique_per_attempt
    unique (attempt_id, guess_number)
);

create index if not exists crackpot_guesses_attempt_idx
  on public.crackpot_guesses (attempt_id, guess_number);

create index if not exists crackpot_guesses_cycle_player_idx
  on public.crackpot_guesses (cycle_id, player_address);

-- ── Updated-at triggers ───────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crackpot_cycles_touch_updated_at on public.crackpot_cycles;
create trigger crackpot_cycles_touch_updated_at
  before update on public.crackpot_cycles
  for each row execute function public.touch_updated_at();

drop trigger if exists crackpot_attempts_touch_updated_at on public.crackpot_attempts;
create trigger crackpot_attempts_touch_updated_at
  before update on public.crackpot_attempts
  for each row execute function public.touch_updated_at();

-- ── RLS: service role only ────────────────────────────────────────
-- All reads/writes go through API routes using the service key.
-- No client-side Supabase access.

alter table public.crackpot_cycles  enable row level security;
alter table public.crackpot_attempts enable row level security;
alter table public.crackpot_guesses  enable row level security;

-- Service role bypasses RLS automatically; deny everything else
create policy crackpot_cycles_deny_all  on public.crackpot_cycles  for all using (false);
create policy crackpot_attempts_deny_all on public.crackpot_attempts for all using (false);
create policy crackpot_guesses_deny_all  on public.crackpot_guesses  for all using (false);
