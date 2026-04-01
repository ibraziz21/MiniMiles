create extension if not exists pgcrypto;

create table if not exists public.prosperity_pass_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_address text not null,
  points integer not null check (points > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  superchain_id text,
  safe_address text,
  burn_tx_hash text,
  tx_hash text,
  refund_tx_hash text,
  last_error text,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processing_by text,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prosperity_pass_jobs_status_available_idx
  on public.prosperity_pass_jobs (status, available_at, created_at);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'prosperity_pass_jobs_touch_updated_at'
  ) then
    create trigger prosperity_pass_jobs_touch_updated_at
    before update on public.prosperity_pass_jobs
    for each row
    execute function public.touch_minipoint_updated_at();
  end if;
end
$$;
