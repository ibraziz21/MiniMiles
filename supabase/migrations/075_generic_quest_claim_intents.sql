-- 075_generic_quest_claim_intents.sql
--
-- Generalizes daily_quest_claim_intents into the shared self-claim engine
-- used by every interactive quest family, not just daily check-in
-- (docs/all-quests-self-claim-spec.md §4). The table keeps its name —
-- treated as compatibility debt per the spec — so the working daily
-- check-in recovery state survives this rollout unchanged.

alter table daily_quest_claim_intents add column if not exists scope_key text;
alter table daily_quest_claim_intents add column if not exists claim_nonce text;
alter table daily_quest_claim_intents add column if not exists claim_family text;
alter table daily_quest_claim_intents add column if not exists finalizer_kind text;
alter table daily_quest_claim_intents add column if not exists finalizer_payload jsonb;
alter table daily_quest_claim_intents add column if not exists eligibility_ref text;
alter table daily_quest_claim_intents add column if not exists chain_confirmed_at timestamptz;
alter table daily_quest_claim_intents add column if not exists legacy_job_id uuid;

-- Backfill existing daily check-in rows (requirements #1-#2): scope_key was
-- the claim_date, claim_nonce was the day_nonce, and every row so far is the
-- daily_checkin family finalized via daily_engagements.
update daily_quest_claim_intents
set
  scope_key = coalesce(scope_key, claim_date::text),
  claim_nonce = coalesce(claim_nonce, day_nonce::text),
  claim_family = coalesce(claim_family, 'daily_checkin'),
  finalizer_kind = coalesce(finalizer_kind, 'daily_engagement'),
  finalizer_payload = coalesce(
    finalizer_payload,
    jsonb_build_object('questId', quest_id::text, 'claimDate', claim_date::text)
  )
where scope_key is null
   or claim_nonce is null
   or claim_family is null
   or finalizer_kind is null
   or finalizer_payload is null;

-- quest_id becomes text (requirement #3) — Platform reward IDs and other
-- future canonical identifiers are not UUIDs.
alter table daily_quest_claim_intents alter column quest_id type text using quest_id::text;

-- day_nonce/claim_date stay for old code but are optional going forward
-- (requirement #4); new code reads claim_nonce/scope_key instead.
alter table daily_quest_claim_intents alter column day_nonce drop not null;
alter table daily_quest_claim_intents alter column claim_date drop not null;

-- Every row (old and new) must carry the generic fields from here on.
alter table daily_quest_claim_intents alter column finalizer_payload set default '{}'::jsonb;
alter table daily_quest_claim_intents alter column scope_key set not null;
alter table daily_quest_claim_intents alter column claim_nonce set not null;
alter table daily_quest_claim_intents alter column claim_family set not null;
alter table daily_quest_claim_intents alter column finalizer_kind set not null;
alter table daily_quest_claim_intents alter column finalizer_payload set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_quest_claim_intents_claim_nonce_format'
  ) then
    alter table daily_quest_claim_intents
      add constraint daily_quest_claim_intents_claim_nonce_format check (claim_nonce ~ '^[0-9]+$');
  end if;
end;
$$;

-- Replace date-scoped uniqueness with scope-key uniqueness (requirement #5)
-- — for every existing daily row scope_key = claim_date, so this is a
-- no-op change in effective behavior, only in the column it's keyed on.
drop index if exists daily_quest_claim_intents_user_quest_date_key;
create unique index if not exists daily_quest_claim_intents_user_quest_scope_key
  on daily_quest_claim_intents (user_address, quest_id, scope_key);

-- Collision/implementation-bug protection (requirement #6): no wallet may
-- ever hold two intents that would replay the same on-chain nonce.
create unique index if not exists daily_quest_claim_intents_user_nonce_key
  on daily_quest_claim_intents (user_address, claim_nonce);

-- Indexes (requirement #7) — (status, updated_at) already exists from 074.
create index if not exists daily_quest_claim_intents_user_status_idx
  on daily_quest_claim_intents (user_address, status);
create index if not exists daily_quest_claim_intents_family_status_updated_idx
  on daily_quest_claim_intents (claim_family, status, updated_at);

-- Expand status enum with chain_confirmed (requirement #8): the mint is
-- irreversible but the local domain finalizer may still need an idempotent
-- retry independent of re-verifying the chain.
alter table daily_quest_claim_intents drop constraint if exists daily_quest_claim_intents_status_check;
alter table daily_quest_claim_intents add constraint daily_quest_claim_intents_status_check
  check (status in ('issued', 'submitted', 'chain_confirmed', 'confirmed', 'expired'));

-- RLS was already enabled with no anon/authenticated policy in 074
-- (requirement #9) — nothing further needed.
