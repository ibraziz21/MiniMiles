-- Phase 4: first-party merchant-quest rollout audit trail.
-- This replaces browser analytics for the quest lifecycle. The table is
-- service-role-only: no anon/authenticated RLS policies are created.

create table if not exists merchant_quest_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (
    event_type in (
      'proof_recorded',
      'claim_queued',
      'retry_queued',
      'reward_completed',
      'reward_failed'
    )
  ),
  user_address text not null,
  partner_quest_id uuid not null references partner_quests(id),
  iso_week text,
  mint_job_id uuid references minipoint_mint_jobs(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists merchant_quest_events_quest_created_idx
  on merchant_quest_events (partner_quest_id, created_at desc);

create index if not exists merchant_quest_events_type_created_idx
  on merchant_quest_events (event_type, created_at desc);

create index if not exists merchant_quest_events_user_created_idx
  on merchant_quest_events (user_address, created_at desc);

alter table merchant_quest_events enable row level security;
