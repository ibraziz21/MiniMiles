-- Migration 009: Durable settlement job table for Skill Games.
--
-- Each session gets exactly one row. The worker leases rows atomically,
-- signs + submits settleGame(), and advances status. Exhausted or
-- unrecoverable jobs land in manual_review for operator action.
-- Legacy settlement via skill_game_sessions.settle_tx_hash continues to
-- work; this table is the *new* source of truth going forward.

create table if not exists public.skill_game_settlement_jobs (
  id               uuid          primary key default gen_random_uuid(),
  session_id       text          not null unique references public.skill_game_sessions(session_id),
  wallet_address   text          not null,
  game_type        text          not null,
  score            integer       not null,
  reward_miles     integer       not null default 0,
  reward_stable    numeric(10,6) not null default 0,
  status           text          not null default 'queued'
                                 check (status in (
                                   'queued','leased','submitted',
                                   'confirmed','retrying','failed','manual_review'
                                 )),
  tx_hash          text,
  attempts         integer       not null default 0,
  last_error       text,
  leased_at        timestamptz,
  lease_owner      text,
  next_attempt_at  timestamptz   not null default now(),
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

-- Worker picks up jobs due for processing: (status, next_attempt_at)
create index if not exists skill_game_settlement_jobs_runnable
  on public.skill_game_settlement_jobs (next_attempt_at, status)
  where status in ('queued', 'retrying');

-- History / per-wallet recovery lookups
create index if not exists skill_game_settlement_jobs_wallet_created
  on public.skill_game_settlement_jobs (wallet_address, created_at desc);

-- Backfill: promote existing accepted/unsettled skill_game_sessions rows so
-- the new worker can pick them up. Only sessions with an actual reward are
-- worth settling. Rows already in manual_review (≥12 attempts) are skipped.
-- The legacy retryPendingSettlements() remains as a safety net.
insert into public.skill_game_settlement_jobs (
  session_id,
  wallet_address,
  game_type,
  score,
  reward_miles,
  reward_stable,
  status,
  tx_hash,
  attempts,
  next_attempt_at
)
select
  s.session_id,
  s.wallet_address,
  s.game_type,
  coalesce(s.score::integer,            0),
  coalesce(s.reward_miles::integer,     0),
  coalesce(s.reward_stable::numeric(10,6), 0),
  case
    when s.settle_tx_hash is not null then 'submitted'
    when coalesce(s.settle_attempts, 0)  > 0 then 'retrying'
    else 'queued'
  end,
  s.settle_tx_hash,
  coalesce(s.settle_attempts, 0),
  now()
from public.skill_game_sessions s
where s.accepted    = true
  and s.settled_at  is null
  and (s.reward_miles > 0 or s.reward_stable > 0)
  and coalesce(s.settle_attempts, 0) < 12
on conflict (session_id) do nothing;
