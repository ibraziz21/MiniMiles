create extension if not exists pgcrypto;

create table if not exists public.minipoint_mint_jobs (
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

create index if not exists minipoint_mint_jobs_status_available_idx
  on public.minipoint_mint_jobs (status, available_at, created_at);

create table if not exists public.minipoint_mint_queue_locks (
  lock_name text primary key,
  owner text not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_minipoint_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'minipoint_mint_jobs_touch_updated_at'
  ) then
    create trigger minipoint_mint_jobs_touch_updated_at
    before update on public.minipoint_mint_jobs
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
    where tgname = 'minipoint_mint_queue_locks_touch_updated_at'
  ) then
    create trigger minipoint_mint_queue_locks_touch_updated_at
    before update on public.minipoint_mint_queue_locks
    for each row
    execute function public.touch_minipoint_updated_at();
  end if;
end
$$;

create or replace function public.acquire_minipoint_mint_queue_lock(
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
  insert into public.minipoint_mint_queue_locks (lock_name, owner, locked_until)
  values (p_lock_name, p_owner, now() + make_interval(secs => p_lease_seconds))
  on conflict (lock_name) do update
    set owner = excluded.owner,
        locked_until = excluded.locked_until
  where public.minipoint_mint_queue_locks.locked_until < now()
     or public.minipoint_mint_queue_locks.owner = excluded.owner;

  select owner into v_owner
  from public.minipoint_mint_queue_locks
  where lock_name = p_lock_name
    and locked_until > now();

  return v_owner = p_owner;
end;
$$;

create or replace function public.release_minipoint_mint_queue_lock(
  p_lock_name text,
  p_owner text
)
returns boolean
language sql
security definer
as $$
  update public.minipoint_mint_queue_locks
  set locked_until = now()
  where lock_name = p_lock_name
    and owner = p_owner;

  select true;
$$;

create or replace function public.claim_next_minipoint_mint_job(
  p_lock_name text,
  p_owner text
)
returns setof public.minipoint_mint_jobs
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1
    from public.minipoint_mint_queue_locks
    where lock_name = p_lock_name
      and owner = p_owner
      and locked_until > now()
  ) then
    return;
  end if;

  return query
  update public.minipoint_mint_jobs
  set status = 'processing',
      processing_by = p_owner,
      processing_started_at = now(),
      attempts = attempts + 1
  where id = (
    select id
    from public.minipoint_mint_jobs
    where status = 'pending'
      and available_at <= now()
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning *;
end;
$$;

create or replace function public.complete_minipoint_mint_job(
  p_job_id uuid,
  p_tx_hash text
)
returns void
language sql
security definer
as $$
  update public.minipoint_mint_jobs
  set status = 'completed',
      tx_hash = p_tx_hash,
      last_error = null
  where id = p_job_id;
$$;

create or replace function public.retry_minipoint_mint_job(
  p_job_id uuid,
  p_error text,
  p_delay_seconds integer default 5
)
returns void
language sql
security definer
as $$
  update public.minipoint_mint_jobs
  set status = 'pending',
      last_error = left(coalesce(p_error, 'retry'), 2000),
      available_at = now() + make_interval(secs => greatest(p_delay_seconds, 1)),
      processing_by = null,
      processing_started_at = null
  where id = p_job_id;
$$;

create or replace function public.fail_minipoint_mint_job(
  p_job_id uuid,
  p_error text
)
returns void
language sql
security definer
as $$
  update public.minipoint_mint_jobs
  set status = 'failed',
      last_error = left(coalesce(p_error, 'failed'), 2000),
      processing_by = null,
      processing_started_at = null
  where id = p_job_id;
$$;
