-- daily_engagements: add source and tx_hash for on-chain claim tracking
-- Safe to re-run.

alter table daily_engagements
  add column if not exists source  text    default 'backend',
  add column if not exists tx_hash text;

-- Backfill existing rows so they're labelled correctly
update daily_engagements
   set source = 'backend'
 where source is null;

-- The unique constraint (user_address, quest_id, claimed_at) is the atomic lock
-- that prevents duplicate vouchers being issued for the same user/quest/day.
-- Add it if it doesn't already exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'daily_engagements_user_quest_day_unique'
  ) then
    alter table daily_engagements
      add constraint daily_engagements_user_quest_day_unique
      unique (user_address, quest_id, claimed_at);
  end if;
end $$;
