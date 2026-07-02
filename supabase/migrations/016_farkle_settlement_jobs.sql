-- Farkle durable settlement jobs.
--
-- Completed matches are now queued into this table before Railway attempts the
-- on-chain settlement. A background worker leases due rows and retries until
-- settlement is confirmed or the job needs manual review.

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

create table if not exists public.farkle_settlement_jobs (
  id                 uuid primary key default gen_random_uuid(),
  match_id           uuid not null unique references public.game_matches(id) on delete cascade,
  mode_key           text not null,
  winner_address     text not null,
  loser_address      text not null,
  winner_score       integer not null default 0,
  loser_score        integer not null default 0,
  win_miles          integer not null default 0,
  los_miles          integer not null default 0,
  win_credit_cents   integer not null default 0,
  chain_id           integer not null default 42220,
  status             text not null default 'queued'
                       check (status in (
                         'queued',
                         'leased',
                         'submitted',
                         'confirmed',
                         'retrying',
                         'failed',
                         'manual_review'
                       )),
  tx_hash            text,
  attempts           integer not null default 0 check (attempts >= 0),
  last_error         text,
  leased_at          timestamptz,
  lease_owner        text,
  next_attempt_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists farkle_settlement_jobs_runnable_idx
  on public.farkle_settlement_jobs (status, next_attempt_at, leased_at)
  where status in ('queued', 'retrying');

create index if not exists farkle_settlement_jobs_winner_created_idx
  on public.farkle_settlement_jobs (winner_address, created_at desc);

create index if not exists farkle_settlement_jobs_match_idx
  on public.farkle_settlement_jobs (match_id);

drop trigger if exists farkle_settlement_jobs_touch_updated_at on public.farkle_settlement_jobs;
create trigger farkle_settlement_jobs_touch_updated_at
  before update on public.farkle_settlement_jobs
  for each row execute function public.touch_updated_at();

-- Backfill is dynamic so older live schemas that are missing a column fail
-- gracefully instead of preventing the table from being created.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'game_matches'
      and column_name = 'settled_at'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'game_matches'
      and column_name = 'mode_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'game_modes'
      and column_name = 'winner_reward_credit'
  ) then
    execute $backfill$
      insert into public.farkle_settlement_jobs (
        match_id,
        mode_key,
        winner_address,
        loser_address,
        winner_score,
        loser_score,
        win_miles,
        los_miles,
        win_credit_cents,
        chain_id,
        status,
        next_attempt_at
      )
      select
        m.id,
        gm.mode_key,
        lower(m.winner_address),
        lower(m.loser_address),
        coalesce(m.winner_score, 0),
        coalesce(m.loser_score, 0),
        coalesce(gm.winner_miles_reward, 10),
        coalesce(gm.loser_miles_reward, 5),
        coalesce(gm.winner_reward_credit, 0),
        coalesce(m.chain_id, 42220),
        'queued',
        now()
      from public.game_matches m
      join public.game_modes gm on gm.id = m.mode_id
      where m.status = 'completed'
        and m.settled_at is null
        and m.winner_address is not null
        and m.loser_address is not null
        and gm.mode_key in ('FARKLE_QUICK_1500_AKIBA', 'FARKLE_REWARD_3000_USDT')
      on conflict (match_id) do nothing
    $backfill$;
  end if;
end;
$$;

alter table public.farkle_settlement_jobs enable row level security;

drop policy if exists service_role_all on public.farkle_settlement_jobs;
create policy service_role_all on public.farkle_settlement_jobs
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
