-- Minipoints mint queue health checks.
-- Run these in Supabase SQL editor while the backend worker is running.

-- 1) Queue status and age.
select
  now() as checked_at,
  status,
  count(*) as jobs,
  coalesce(sum(points), 0) as total_points,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at,
  max(updated_at) as last_updated_at,
  round(extract(epoch from now() - min(created_at)) / 60) as oldest_age_minutes
from public.minipoint_mint_jobs
group by status
order by status;

-- 2) Pending due now vs scheduled future, plus last completed activity.
select
  count(*) filter (
    where status = 'pending' and available_at <= now()
  ) as pending_due_now,
  count(*) filter (
    where status = 'pending' and available_at > now()
  ) as pending_future,
  count(*) filter (
    where status = 'processing'
  ) as processing,
  min(created_at) filter (
    where status = 'pending' and available_at <= now()
  ) as oldest_pending_due,
  max(updated_at) filter (
    where status = 'completed'
  ) as last_completed
from public.minipoint_mint_jobs;

-- 3) Queue locks. For minipoints the backend uses lock_name = 'default'.
select
  lock_name,
  owner,
  locked_until,
  updated_at,
  locked_until > now() as active,
  round(extract(epoch from locked_until - now())) as seconds_until_unlock
from public.minipoint_mint_queue_locks
order by lock_name;

-- 4) Processing rows by owner. If the worker says it is running but this is
-- empty and the lock is expired, the process-local worker guard is stale.
select
  processing_by,
  count(*) as jobs,
  min(processing_started_at) as oldest_processing_started_at,
  max(updated_at) as newest_processing_updated_at
from public.minipoint_mint_jobs
where status = 'processing'
group by processing_by
order by oldest_processing_started_at nulls last;

-- 5) Pending pressure by source/reason.
select
  coalesce(payload->>'kind', reason, 'unknown') as source,
  count(*) as jobs,
  coalesce(sum(points), 0) as points,
  min(created_at) as oldest,
  max(created_at) as newest
from public.minipoint_mint_jobs
where status = 'pending'
  and available_at <= now()
group by 1
order by jobs desc;

-- 6) Recent completed mint transactions from the queue.
-- If the contract is minting, the tx hash should appear here shortly after
-- completion unless another service/script submitted it outside the queue.
with tx_summary as (
  select
    tx_hash,
    count(*) as jobs,
    coalesce(sum(points), 0) as total_points,
    min(created_at) as oldest_job_created_at,
    max(updated_at) as completed_at
  from public.minipoint_mint_jobs
  where status = 'completed'
    and tx_hash is not null
    and updated_at >= now() - interval '24 hours'
  group by tx_hash
),
per_source as (
  select
    tx_hash,
    coalesce(payload->>'kind', reason, 'unknown') as source,
    count(*) as jobs,
    coalesce(sum(points), 0) as points
  from public.minipoint_mint_jobs
  where status = 'completed'
    and tx_hash is not null
    and updated_at >= now() - interval '24 hours'
  group by tx_hash, source
),
source_summary as (
  select
    tx_hash,
    jsonb_object_agg(
      source,
      jsonb_build_object('jobs', jobs, 'points', points)
      order by jobs desc
    ) as sources
  from per_source
  group by tx_hash
)
select
  tx_summary.tx_hash,
  tx_summary.jobs,
  tx_summary.total_points,
  tx_summary.oldest_job_created_at,
  tx_summary.completed_at,
  source_summary.sources
from tx_summary
join source_summary on source_summary.tx_hash = tx_summary.tx_hash
order by tx_summary.completed_at desc
limit 50;

-- 7) Paste a Celo explorer tx hash here to see whether it came from this queue.
-- Replace the value in the params CTE.
with params as (
  select lower('0xPASTE_TX_HASH_HERE') as tx_hash
)
select
  j.status,
  count(*) as jobs,
  coalesce(sum(j.points), 0) as total_points,
  min(j.created_at) as oldest_job_created_at,
  max(j.updated_at) as newest_job_updated_at,
  array_agg(distinct coalesce(j.payload->>'kind', j.reason, 'unknown')) as sources
from public.minipoint_mint_jobs j
join params p on lower(j.tx_hash) = p.tx_hash
group by j.status;

-- 8) Recent jobs completed without tx_hash should be zero.
select
  count(*) as completed_without_tx_hash,
  min(updated_at) as oldest,
  max(updated_at) as newest
from public.minipoint_mint_jobs
where status = 'completed'
  and tx_hash is null
  and updated_at >= now() - interval '24 hours';
