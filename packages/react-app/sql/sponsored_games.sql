-- Discovery quests, Stage 2 — "Play the Sponsored Leaderboard" weekly quest
-- (discovery-quests-spec.md §3.4). Run once on Supabase: SQL Editor → paste
-- and execute.
--
-- accepted gets set on skill_game_sessions from THREE independent call
-- sites (packages/backend/src/games/routes.ts's /session/finish and
-- /verify, plus this app's lib/server/skillGamesLocal.ts local fallback).
-- Rather than patching all three, a trigger on skill_game_sessions itself is
-- the single choke point: it fires regardless of which path wrote the row,
-- and the outbox table's unique idempotency_key absorbs any double-fire
-- from overlapping writes to the same session.
--
-- No campaign UI is built here — sponsored_game_campaigns rows are
-- authored manually for now (see the plan's Phase 6 runbook note). This is
-- the minimum schema to satisfy "gate the weekly quest on an active
-- campaign," not a general campaign system.

create table if not exists sponsored_game_campaigns (
  id                          uuid primary key default gen_random_uuid(),
  game_type                   text not null,
  quest_id                    text not null,
  quest_verification_rule_id text not null,
  starts_at                   timestamptz not null,
  ends_at                     timestamptz not null,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now()
);

create index if not exists sponsored_game_campaigns_active_window
  on sponsored_game_campaigns (game_type, active, starts_at, ends_at);

create table if not exists sponsored_game_webhook_jobs (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  wallet_address  text not null,
  game_type       text not null,
  iso_week        text not null,
  campaign_id     uuid not null references sponsored_game_campaigns(id),
  quest_id        text not null,
  quest_verification_rule_id text not null,
  session_id      text not null,
  status          text not null default 'pending' check (status in ('pending', 'processing', 'released', 'failed')),
  attempts        integer not null default 0,
  last_error      text,
  next_retry_at   timestamptz,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sponsored_game_webhook_jobs_pending
  on sponsored_game_webhook_jobs (next_retry_at) where status = 'pending';

alter table sponsored_game_campaigns enable row level security;
alter table sponsored_game_webhook_jobs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'sponsored_game_campaigns' and policyname = 'service_role_all'
  ) then
    execute 'create policy "service_role_all" on sponsored_game_campaigns for all using (auth.role() = ''service_role'')';
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'sponsored_game_webhook_jobs' and policyname = 'service_role_all'
  ) then
    execute 'create policy "service_role_all" on sponsored_game_webhook_jobs for all using (auth.role() = ''service_role'')';
  end if;
end $$;

-- ── Enqueue trigger: fires whenever a row's accepted flips to true ─────────
-- iso_week computed with to_char(..., 'IYYY-"W"IW') — Postgres's ISO 8601
-- week-numbering format, matching the JS isoWeek() helper's algorithm
-- (Thursday-anchored ISO week) so the two never disagree on a week boundary.

create or replace function enqueue_sponsored_game_webhook()
returns trigger
language plpgsql
security definer
as $$
declare
  v_campaign sponsored_game_campaigns%rowtype;
  v_iso_week text;
begin
  if new.accepted is not true then
    return new;
  end if;

  select * into v_campaign
  from sponsored_game_campaigns
  where game_type = new.game_type
    and active = true
    and now() between starts_at and ends_at
  limit 1;

  if not found then
    return new;
  end if;

  v_iso_week := to_char(new.created_at, 'IYYY-"W"IW');

  insert into sponsored_game_webhook_jobs (
    idempotency_key, wallet_address, game_type, iso_week,
    campaign_id, quest_id, quest_verification_rule_id, session_id
  ) values (
    'sgp:' || lower(new.wallet_address) || ':' || new.game_type || ':' || v_iso_week,
    lower(new.wallet_address), new.game_type, v_iso_week,
    v_campaign.id, v_campaign.quest_id, v_campaign.quest_verification_rule_id, new.session_id
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_sponsored_game_webhook on skill_game_sessions;
create trigger trg_enqueue_sponsored_game_webhook
  after insert or update on skill_game_sessions
  for each row
  when (new.accepted = true)
  execute function enqueue_sponsored_game_webhook();

-- ── Worker primitives — same claim/complete shape as reward_jobs ──────────

create or replace function claim_sponsored_game_jobs(p_limit integer default 25)
returns setof sponsored_game_webhook_jobs
language plpgsql
security definer
as $$
begin
  return query
  update sponsored_game_webhook_jobs
  set status = 'processing', updated_at = now()
  where id in (
    select id from sponsored_game_webhook_jobs
    where status = 'pending' and (next_retry_at is null or next_retry_at <= now())
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

create or replace function complete_sponsored_game_job(
  p_job_id uuid,
  p_ok     boolean,
  p_error  text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_attempts integer;
begin
  if p_ok then
    update sponsored_game_webhook_jobs
    set status = 'released', released_at = now(), last_error = null, updated_at = now()
    where id = p_job_id;
  else
    select attempts + 1 into v_attempts from sponsored_game_webhook_jobs where id = p_job_id;
    update sponsored_game_webhook_jobs
    set status = 'pending',
        attempts = v_attempts,
        last_error = p_error,
        next_retry_at = now() + (least(v_attempts, 6) * interval '5 minutes'),
        updated_at = now()
    where id = p_job_id;
  end if;
end;
$$;
