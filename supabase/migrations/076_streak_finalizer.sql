-- 076_streak_finalizer.sql
--
-- Atomic streak-advancement finalizer for the self-claim engine
-- (docs/all-quests-self-claim-spec.md §7: "Streak advancement needs a
-- database RPC/transaction keyed by (wallet, questId, scopeKey). The current
-- read-then-update helper can race and must not be used as the finalizer.").
--
-- helpers/streaks.ts's upsertStreak() does a plain SELECT-then-INSERT/UPDATE
-- with no locking — two concurrent finalizer runs for the same wallet+quest
-- could both read the same prior state and double-advance (or lose an
-- advance). This function replaces that read-then-update with a single
-- locked, transactional operation, and folds the daily_engagements upsert
-- into the same call so both writes succeed or fail together.
--
-- The legacy sponsored path (helpers/streaks.ts, called from the pre-existing
-- /api/streaks/* routes when self-claim is off) is intentionally left as-is —
-- only the new self-claim finalizer (lib/server/dailyClaimIntents.ts) calls
-- this function.

-- streaks predates the tracked migration history in this repo (like
-- daily_engagements) — guard with to_regclass, and add the natural-key
-- uniqueness the existing manual check-then-branch code already assumes but
-- never enforced at the database level.
do $$
begin
  if to_regclass('public.streaks') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'streaks_user_quest_key'
     )
  then
    begin
      execute 'alter table streaks
                 add constraint streaks_user_quest_key
                 unique (user_address, quest_id)';
    exception when unique_violation then
      raise warning 'streaks has duplicate (user_address, quest_id) rows — unique constraint not added, dedupe manually then re-run';
    end;
  end if;
end;
$$;

create or replace function advance_streak_and_engage(
  p_user_address text,
  p_quest_id text,
  p_scope text,             -- 'daily' | 'weekly'
  p_scope_key text,
  p_previous_scope_key text,
  p_claimed_at text,        -- daily_engagements.claimed_at value (date key or ISO-week key)
  p_points_awarded integer,
  p_source text,
  p_tx_hash text
) returns table (current_streak integer, longest_streak integer)
language plpgsql
as $$
declare
  v_current integer;
  v_longest integer;
  v_last_scope_key text;
begin
  -- Lock (or implicitly claim) the streak row for this wallet+quest so a
  -- concurrent finalizer run for the same pair blocks until this one commits,
  -- instead of both reading the same stale current_streak.
  select current_streak, longest_streak, last_scope_key
    into v_current, v_longest, v_last_scope_key
  from streaks
  where user_address = p_user_address and quest_id::text = p_quest_id
  for update;

  if not found then
    v_current := 0;
    v_longest := 0;
    v_last_scope_key := null;
  end if;

  if v_last_scope_key = p_scope_key then
    -- Idempotent retry for the same scope (e.g. a finalizer retried after a
    -- transient failure) — do not double-advance.
    null;
  elsif v_last_scope_key = p_previous_scope_key then
    v_current := v_current + 1;
  else
    v_current := 1;
  end if;

  v_longest := greatest(v_longest, v_current);

  insert into streaks (user_address, quest_id, scope, current_streak, longest_streak, last_scope_key)
  values (p_user_address, p_quest_id, p_scope, v_current, v_longest, p_scope_key)
  on conflict (user_address, quest_id)
  do update set
    scope = excluded.scope,
    current_streak = excluded.current_streak,
    longest_streak = excluded.longest_streak,
    last_scope_key = excluded.last_scope_key;

  insert into daily_engagements (user_address, quest_id, claimed_at, points_awarded, source, tx_hash)
  values (p_user_address, p_quest_id, p_claimed_at, p_points_awarded, p_source, p_tx_hash)
  on conflict (user_address, quest_id, claimed_at) do nothing;

  return query select v_current, v_longest;
end;
$$;
