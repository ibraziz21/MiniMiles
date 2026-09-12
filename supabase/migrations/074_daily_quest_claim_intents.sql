-- 074_daily_quest_claim_intents.sql
--
-- Daily check-in self-claim (docs/daily-checkin-self-claim-spec.md §2).
-- daily_quest_claim_intents tracks a voucher from issuance through
-- confirmation; it is NOT a completed engagement. daily_engagements keeps
-- meaning "reward actually delivered" and gains source/tx_hash so both the
-- sponsored queue path and the new self-claim path can write into it.

create table if not exists daily_quest_claim_intents (
  id uuid primary key default gen_random_uuid(),
  user_address text not null,
  quest_id uuid not null,
  claim_date date not null,
  day_nonce bigint not null,
  base_points integer not null,
  points_awarded integer not null,
  amount_wei text not null,
  vault_boost jsonb not null default '{}'::jsonb,
  deadline bigint not null,
  status text not null default 'issued',
  tx_hash text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,

  constraint daily_quest_claim_intents_user_address_format
    check (user_address ~ '^0x[0-9a-f]{40}$'),
  constraint daily_quest_claim_intents_amount_wei_format
    check (amount_wei ~ '^[0-9]+$'),
  constraint daily_quest_claim_intents_status_check
    check (status in ('issued', 'submitted', 'confirmed', 'expired'))
);

create unique index if not exists daily_quest_claim_intents_user_quest_date_key
  on daily_quest_claim_intents (user_address, quest_id, claim_date);

create index if not exists daily_quest_claim_intents_status_updated_idx
  on daily_quest_claim_intents (status, updated_at);

alter table daily_quest_claim_intents enable row level security;

-- No anonymous/authenticated client access — API routes use the service-role
-- Supabase client (lib/supabaseClient.ts). No policies are created, so RLS
-- denies all access from the anon/authenticated roles by default.

-- ── daily_engagements compatibility columns ─────────────────────────────────
-- daily_engagements predates the tracked migration history in this repo, so
-- guard every statement with to_regclass in case it's absent in a given
-- environment (mirrors the pattern in 054_canonical_partner_quest_completion.sql).
do $$
begin
  if to_regclass('public.daily_engagements') is not null then
    execute 'alter table daily_engagements add column if not exists source text default ''backend''';
    execute 'alter table daily_engagements add column if not exists tx_hash text';
    execute 'update daily_engagements set source = ''backend'' where source is null';

    if not exists (
      select 1 from pg_constraint
      where conname = 'daily_engagements_user_quest_claimed_key'
    ) then
      begin
        execute 'alter table daily_engagements
                   add constraint daily_engagements_user_quest_claimed_key
                   unique (user_address, quest_id, claimed_at)';
      exception when unique_violation then
        raise warning 'daily_engagements has duplicate (user_address, quest_id, claimed_at) rows — unique constraint not added, dedupe manually then re-run';
      end;
    end if;
  end if;
end;
$$;
