-- CrackPot settlement jobs + fairness commitment fields.
--
-- Changes:
--   1. Add `settling` status to crackpot_cycles (between active and cracked).
--   2. Replace the one-active-per-version partial index so it also covers
--      `settling` — prevents a new cycle opening while a winner payout is pending.
--   3. Add payout/reveal columns to crackpot_cycles.
--   4. Create crackpot_payout_jobs table (durable settlement queue).

-- ── 1. Widen status check to include 'settling' ───────────────────────────────

alter table public.crackpot_cycles
  drop constraint if exists crackpot_cycles_status_check;

alter table public.crackpot_cycles
  add constraint crackpot_cycles_status_check
  check (status in ('active', 'settling', 'cracked', 'dead'));

-- ── 2. Update unique index so at most one 'live' cycle (active|settling) ───────

drop index if exists crackpot_cycles_one_active_per_version;
drop index if exists crackpot_cycles_chain_version_idx;

create unique index if not exists crackpot_cycles_one_live_per_version
  on public.crackpot_cycles (version)
  where status in ('active', 'settling');

-- Restore chain-version lookup index (broader status coverage).
create index if not exists crackpot_cycles_chain_version_idx
  on public.crackpot_cycles (chain_id, contract_version, status)
  where status in ('active', 'settling');

-- ── 3. Add payout / reveal columns to crackpot_cycles ────────────────────────

-- Payout amount stored in the same unit as pot_balance:
--   Miles  → whole miles (int)
--   USDT   → integer cents (int)
alter table public.crackpot_cycles
  add column if not exists payout_amount        integer,
  add column if not exists cracked_at           timestamptz,
  add column if not exists commitment_algorithm  text,
  add column if not exists secret_revealed_at   timestamptz;

-- ── 4. crackpot_payout_jobs ───────────────────────────────────────────────────
-- One row per cracking event.  The idempotency_key is unique so retrying the
-- correct-guess route never inserts a duplicate job.
-- Row locking (FOR UPDATE SKIP LOCKED) is done in the worker query.

create table if not exists public.crackpot_payout_jobs (
  id                  uuid        primary key default gen_random_uuid(),

  -- Chain context — needed by the worker to call declareWinner.
  cycle_id            uuid        not null references public.crackpot_cycles(id) on delete cascade,
  chain_id            integer     not null,
  contract_cycle_id   integer     not null,
  contract_version    integer     not null,

  -- Winner info.
  winner_address      text        not null,
  winner_guesses      integer     not null,

  -- Idempotency: exactly one job per cycle on a given chain.
  idempotency_key     text        not null,

  -- Job lifecycle.
  status              text        not null default 'queued'
                                    check (status in (
                                      'queued',
                                      'processing',
                                      'succeeded',
                                      'failed',
                                      'manual_review'
                                    )),

  -- Filled in after the chain tx is confirmed.
  tx_hash             text,
  payout_amount       integer,    -- same unit as cycle pot_balance

  -- Retry bookkeeping.
  attempts            integer     not null default 0 check (attempts >= 0),
  last_error          text,
  leased_at           timestamptz,
  lease_owner         text,
  next_attempt_at     timestamptz not null default now(),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Idempotency: one job per cycle (on a given chain).
create unique index if not exists crackpot_payout_jobs_idempotency_uniq
  on public.crackpot_payout_jobs (idempotency_key);

-- Fast path for the worker to find runnable jobs.
create index if not exists crackpot_payout_jobs_runnable_idx
  on public.crackpot_payout_jobs (status, next_attempt_at)
  where status in ('queued', 'failed');

create index if not exists crackpot_payout_jobs_cycle_idx
  on public.crackpot_payout_jobs (cycle_id);

drop trigger if exists crackpot_payout_jobs_touch_updated_at on public.crackpot_payout_jobs;
create trigger crackpot_payout_jobs_touch_updated_at
  before update on public.crackpot_payout_jobs
  for each row execute function public.touch_updated_at();

-- ── 5. RLS ────────────────────────────────────────────────────────────────────

alter table public.crackpot_payout_jobs enable row level security;

drop policy if exists crackpot_payout_jobs_deny_all on public.crackpot_payout_jobs;
create policy crackpot_payout_jobs_deny_all on public.crackpot_payout_jobs
  for all using (false);
