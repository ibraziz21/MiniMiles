-- minipoint_burn_queue.sql
-- Async Miles burn queue, mirroring minipoint_mint_queue.sql's job/lock
-- table shape and RPC set exactly, plus one new thing mint never needed:
-- reserve_miles_burn(), an atomic, advisory-locked reservation that checks
-- spendable balance (on-chain balance minus everything already reserved in
-- this queue) before a job is ever inserted. The inserted row IS the
-- reservation — from the instant it exists, any other concurrent caller
-- summing this user's pending/processing rows sees it, closing the
-- double-spend window at enqueue time rather than at drain time.
--
-- Used by:
--   - app/api/Spend/vouchers/issue/route.ts (voucher purchase burn)
--   - lib/prosperityPassQueue.ts (reservation only — prosperityPassWorker.ts
--     keeps executing its own burn call directly; it just completes the
--     matching row here afterward so the reservation clears)
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.minipoint_burn_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_address text not null,
  points integer not null check (points > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  tx_hash text,
  last_error text,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  processing_by text,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists minipoint_burn_jobs_status_available_idx
  on public.minipoint_burn_jobs (status, available_at, created_at);

-- Reservation lookups sum by (user_address, status) — index accordingly.
create index if not exists minipoint_burn_jobs_user_status_idx
  on public.minipoint_burn_jobs (user_address, status);

create table if not exists public.minipoint_burn_queue_locks (
  lock_name text primary key,
  owner text not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'minipoint_burn_jobs_touch_updated_at'
  ) then
    create trigger minipoint_burn_jobs_touch_updated_at
    before update on public.minipoint_burn_jobs
    for each row
    execute function public.touch_minipoint_updated_at();
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'minipoint_burn_queue_locks_touch_updated_at'
  ) then
    create trigger minipoint_burn_queue_locks_touch_updated_at
    before update on public.minipoint_burn_queue_locks
    for each row
    execute function public.touch_minipoint_updated_at();
  end if;
end
$$;

-- ── Reservation — the double-spend guard ──────────────────────────────────────
create or replace function public.reserve_miles_burn(
  p_user_address    text,
  p_points          integer,
  p_onchain_balance numeric,
  p_idempotency_key text,
  p_reason          text,
  p_payload         jsonb default '{}'::jsonb
)
returns table (job_id uuid, already_existed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved numeric;
  v_job_id   uuid;
begin
  -- Idempotent: a retried request with the same key returns the same job,
  -- never double-reserves.
  select id into v_job_id
    from minipoint_burn_jobs
   where idempotency_key = p_idempotency_key;

  if v_job_id is not null then
    return query select v_job_id, true;
    return;
  end if;

  -- Advisory-locked per user — same pattern as reserve_voucher_atomic's
  -- per-template lock, serializing all concurrent burn-reservations for
  -- this user so the balance check below can't race.
  perform pg_advisory_xact_lock(hashtext(p_user_address));

  select coalesce(sum(points), 0) into v_reserved
    from minipoint_burn_jobs
   where user_address = p_user_address
     and status in ('pending', 'processing');

  if p_onchain_balance - v_reserved < p_points then
    raise exception 'INSUFFICIENT_BALANCE: spendable % < requested %',
      (p_onchain_balance - v_reserved), p_points
      using errcode = 'P0001';
  end if;

  insert into minipoint_burn_jobs (idempotency_key, user_address, points, reason, payload)
  values (p_idempotency_key, p_user_address, p_points, p_reason, coalesce(p_payload, '{}'::jsonb))
  returning id into v_job_id;

  return query select v_job_id, false;
end;
$$;

revoke all on function public.reserve_miles_burn(text, integer, numeric, text, text, jsonb) from public;
revoke all on function public.reserve_miles_burn(text, integer, numeric, text, text, jsonb) from anon;
revoke all on function public.reserve_miles_burn(text, integer, numeric, text, text, jsonb) from authenticated;
grant execute on function public.reserve_miles_burn(text, integer, numeric, text, text, jsonb) to service_role;

-- ── Queue lock RPCs — direct mirrors of the mint queue's ──────────────────────
create or replace function public.acquire_minipoint_burn_queue_lock(
  p_lock_name text,
  p_owner text,
  p_lease_seconds integer default 30
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_owner text;
begin
  insert into public.minipoint_burn_queue_locks (lock_name, owner, locked_until)
  values (p_lock_name, p_owner, now() + make_interval(secs => p_lease_seconds))
  on conflict (lock_name) do update
    set owner = excluded.owner,
        locked_until = excluded.locked_until
  where public.minipoint_burn_queue_locks.locked_until < now()
     or public.minipoint_burn_queue_locks.owner = excluded.owner;

  select owner into v_owner
  from public.minipoint_burn_queue_locks
  where lock_name = p_lock_name
    and locked_until > now();

  return v_owner = p_owner;
end;
$$;

create or replace function public.release_minipoint_burn_queue_lock(
  p_lock_name text,
  p_owner text
)
returns boolean
language sql
security definer
as $$
  update public.minipoint_burn_queue_locks
  set locked_until = now()
  where lock_name = p_lock_name
    and owner = p_owner;

  select true;
$$;

create or replace function public.claim_next_minipoint_burn_job(
  p_lock_name text,
  p_owner text
)
returns setof public.minipoint_burn_jobs
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1
    from public.minipoint_burn_queue_locks
    where lock_name = p_lock_name
      and owner = p_owner
      and locked_until > now()
  ) then
    return;
  end if;

  -- payload.kind = 'passport_burn' rows are reservation-only bookkeeping —
  -- prosperityPassWorker.ts executes that exact burn itself and completes
  -- the row directly (lib/prosperityPassQueue.ts). If this claimed and
  -- executed them too, the same Miles would be burned on-chain twice.
  return query
  update public.minipoint_burn_jobs
  set status = 'processing',
      processing_by = p_owner,
      processing_started_at = now(),
      attempts = attempts + 1
  where id = (
    select id
    from public.minipoint_burn_jobs
    where status = 'pending'
      and available_at <= now()
      and coalesce(payload->>'kind', '') <> 'passport_burn'
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning *;
end;
$$;

create or replace function public.complete_minipoint_burn_job(
  p_job_id uuid,
  p_tx_hash text
)
returns void
language sql
security definer
as $$
  update public.minipoint_burn_jobs
  set status = 'completed',
      tx_hash = p_tx_hash,
      last_error = null
  where id = p_job_id;
$$;

create or replace function public.retry_minipoint_burn_job(
  p_job_id uuid,
  p_error text,
  p_delay_seconds integer default 5
)
returns void
language sql
security definer
as $$
  update public.minipoint_burn_jobs
  set status = 'pending',
      last_error = left(coalesce(p_error, 'retry'), 2000),
      available_at = now() + make_interval(secs => greatest(p_delay_seconds, 1)),
      processing_by = null,
      processing_started_at = null
  where id = p_job_id;
$$;

create or replace function public.fail_minipoint_burn_job(
  p_job_id uuid,
  p_error text
)
returns void
language sql
security definer
as $$
  update public.minipoint_burn_jobs
  set status = 'failed',
      last_error = left(coalesce(p_error, 'failed'), 2000),
      processing_by = null,
      processing_started_at = null
  where id = p_job_id;
$$;
