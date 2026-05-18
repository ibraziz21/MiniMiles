-- Read-only mint queue status checks.
-- Run in Supabase SQL editor when you need to inspect minipoint_mint_jobs.
-- Edit the params CTEs below for a shorter/longer lookback or a specific wallet.

-- 1) Overall queue health.
with params as (
  select
    interval '7 days' as lookback,
    interval '10 minutes' as stale_after
)
select
  count(*) as total_jobs,
  count(*) filter (where status = 'pending' and available_at <= now()) as pending_ready,
  count(*) filter (where status = 'pending' and available_at > now()) as pending_delayed,
  count(*) filter (where status = 'processing') as processing,
  count(*) filter (
    where status = 'processing'
      and coalesce(processing_started_at, updated_at) < now() - (select stale_after from params)
  ) as stale_processing,
  count(*) filter (where status = 'completed') as completed,
  count(*) filter (where status = 'failed') as failed,
  sum(points) as total_points,
  now() - (min(created_at) filter (
    where status = 'pending'
      and available_at <= now()
  )) as oldest_ready_pending_age,
  (min(available_at) filter (
    where status = 'pending'
      and available_at > now()
  )) as next_delayed_job_available_at
from public.minipoint_mint_jobs
where created_at >= now() - (select lookback from params);

-- 2) Counts by status.
with params as (
  select
    interval '7 days' as lookback,
    interval '10 minutes' as stale_after
)
select
  status,
  count(*) as jobs,
  count(*) filter (where status = 'pending' and available_at <= now()) as ready_now,
  count(*) filter (where status = 'pending' and available_at > now()) as delayed,
  count(*) filter (
    where status = 'processing'
      and coalesce(processing_started_at, updated_at) < now() - (select stale_after from params)
  ) as stale,
  sum(points) as points,
  min(created_at) as oldest_created_at,
  max(updated_at) as latest_updated_at
from public.minipoint_mint_jobs
where created_at >= now() - (select lookback from params)
group by status
order by case status
  when 'pending' then 1
  when 'processing' then 2
  when 'failed' then 3
  when 'completed' then 4
  else 5
end;

-- 3) Counts by payload kind and status.
with params as (
  select interval '7 days' as lookback
)
select
  coalesce(payload->>'kind', 'unknown') as payload_kind,
  status,
  count(*) as jobs,
  sum(points) as points,
  max(updated_at) as latest_updated_at
from public.minipoint_mint_jobs
where created_at >= now() - (select lookback from params)
group by coalesce(payload->>'kind', 'unknown'), status
order by payload_kind, status;

-- 4) Queue locks. An active lock means a worker currently owns the queue lease.
select
  lock_name,
  owner,
  locked_until,
  locked_until > now() as is_active,
  greatest(0, ceil(extract(epoch from locked_until - now())))::integer as seconds_until_expiry,
  updated_at
from public.minipoint_mint_queue_locks
order by lock_name;

-- 5) Stale processing jobs. These are candidates for worker recovery.
with params as (
  select interval '10 minutes' as stale_after
)
select
  id,
  idempotency_key,
  user_address,
  points,
  reason,
  coalesce(payload->>'kind', 'unknown') as payload_kind,
  attempts,
  processing_by,
  processing_started_at,
  updated_at,
  now() - coalesce(processing_started_at, updated_at) as processing_age,
  left(coalesce(last_error, ''), 240) as last_error
from public.minipoint_mint_jobs
where status = 'processing'
  and coalesce(processing_started_at, updated_at) < now() - (select stale_after from params)
order by coalesce(processing_started_at, updated_at) asc
limit 100;

-- 6) Pending backlog, oldest first.
select
  id,
  idempotency_key,
  user_address,
  points,
  reason,
  coalesce(payload->>'kind', 'unknown') as payload_kind,
  payload->>'questId' as quest_id,
  payload->>'claimedAt' as claimed_at,
  attempts,
  available_at,
  case when available_at <= now() then 'ready' else 'delayed' end as availability,
  greatest(0, ceil(extract(epoch from available_at - now())))::integer as seconds_until_available,
  created_at,
  now() - created_at as job_age,
  left(coalesce(last_error, ''), 240) as last_error
from public.minipoint_mint_jobs
where status = 'pending'
order by available_at asc, created_at asc
limit 100;

-- 7) Recent failures or retry errors.
select
  id,
  idempotency_key,
  user_address,
  points,
  reason,
  status,
  coalesce(payload->>'kind', 'unknown') as payload_kind,
  payload->>'questId' as quest_id,
  attempts,
  tx_hash,
  updated_at,
  left(coalesce(last_error, ''), 500) as last_error
from public.minipoint_mint_jobs
where status = 'failed'
   or last_error is not null
order by updated_at desc
limit 100;

-- 8) Recent job timeline.
select
  id,
  idempotency_key,
  user_address,
  points,
  reason,
  status,
  coalesce(payload->>'kind', 'unknown') as payload_kind,
  payload->>'questId' as quest_id,
  payload->>'claimedAt' as claimed_at,
  attempts,
  tx_hash,
  created_at,
  updated_at
from public.minipoint_mint_jobs
order by created_at desc
limit 100;

-- 9) Optional focused lookup. Replace nulls with values when needed.
-- Example: select lower('0xabc...') as wallet_address, null::text as idempotency_key
with params as (
  select
    null::text as wallet_address,
    null::text as idempotency_key,
    interval '30 days' as lookback
)
select
  id,
  idempotency_key,
  user_address,
  points,
  reason,
  status,
  coalesce(payload->>'kind', 'unknown') as payload_kind,
  payload,
  attempts,
  tx_hash,
  last_error,
  available_at,
  processing_by,
  processing_started_at,
  created_at,
  updated_at
from public.minipoint_mint_jobs, params
where created_at >= now() - params.lookback
  and (params.wallet_address is null or user_address = lower(params.wallet_address))
  and (params.idempotency_key is null or idempotency_key = params.idempotency_key)
order by created_at desc
limit 100;
