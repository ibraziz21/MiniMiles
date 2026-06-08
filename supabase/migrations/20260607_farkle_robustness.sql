-- =============================================================
-- Farkle robustness: turn timing for reconnection + timeout handling
-- Run in Supabase SQL editor (safe to re-run)
-- =============================================================

alter table game_matches add column if not exists turn_started_at timestamptz;
alter table game_matches add column if not exists last_action_at  timestamptz;

-- Backfill existing in-progress matches so the timeout clock starts now
update game_matches
  set turn_started_at = coalesce(turn_started_at, now()),
      last_action_at  = coalesce(last_action_at, now())
  where status = 'in_progress';

-- Align existing mode config with the product rule: quick games end at 1,500,
-- reward/USDT games end at 2,500. The initial seed used "do nothing" on
-- conflict, so already-created rows need an explicit correction.
update game_modes
   set target_score = 1500
 where mode_key = 'FARKLE_QUICK_1500_AKIBA'
   and target_score is distinct from 1500;

update game_modes
   set target_score = 2500
 where mode_key = 'FARKLE_REWARD_3000_USDT'
   and target_score is distinct from 2500;

-- Fast lookup of a player's active match (reconnection)
create index if not exists idx_match_players_wallet_match
  on game_match_players (wallet_address, match_id);

create index if not exists idx_game_matches_active
  on game_matches (status)
  where status in ('in_progress', 'funded', 'created');

create index if not exists idx_game_matches_in_progress_turn_deadline
  on game_matches (turn_started_at)
  where status = 'in_progress';

create index if not exists idx_matchmaking_queue_expiry
  on matchmaking_queue (expires_at)
  where status = 'waiting';

-- Keep the DB action enum aligned with the API. The original table only
-- allowed roll/bank/forfeit/hot_dice, but the roll route records farkle and
-- roll_again outcomes.
alter table farkle_turns drop constraint if exists farkle_turns_action_check;
alter table farkle_turns
  add constraint farkle_turns_action_check
  check (action in ('roll', 'roll_again', 'bank', 'farkle', 'forfeit', 'hot_dice', 'timeout'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'game_matches_turn_number_positive'
  ) then
    alter table game_matches
      add constraint game_matches_turn_number_positive
      check (turn_number is null or turn_number >= 1) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'game_match_players_banked_score_nonnegative'
  ) then
    alter table game_match_players
      add constraint game_match_players_banked_score_nonnegative
      check (banked_score >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'farkle_turns_numbers_positive'
  ) then
    alter table farkle_turns
      add constraint farkle_turns_numbers_positive
      check (
        turn_number >= 1
        and roll_number >= 1
        and turn_points >= 0
        and banked_points >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'farkle_turns_dice_values_valid'
  ) then
    alter table farkle_turns
      add constraint farkle_turns_dice_values_valid
      check (cardinality(dice_values) = 6 and dice_values <@ array[1,2,3,4,5,6])
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'farkle_turns_selected_dice_valid'
  ) then
    alter table farkle_turns
      add constraint farkle_turns_selected_dice_valid
      check (cardinality(selected_dice) <= 6 and selected_dice <@ array[0,1,2,3,4,5])
      not valid;
  end if;
end $$;

-- Prevent duplicate move writes from retries/double taps. If existing duplicate
-- data is already present, skip the unique index so this migration can still run;
-- clean duplicates first, then re-run to create the guard.
do $$
begin
  if not exists (
    select 1
      from farkle_turns
     group by match_id, turn_number, roll_number
    having count(*) > 1
     limit 1
  ) then
    execute 'create unique index if not exists idx_farkle_turns_unique_roll on farkle_turns (match_id, turn_number, roll_number)';
  else
    raise notice 'Skipped idx_farkle_turns_unique_roll because duplicate turn rows already exist';
  end if;
end $$;

create index if not exists idx_farkle_turns_latest_player_turn
  on farkle_turns (match_id, wallet_address, turn_number, roll_number desc);

-- Ticket sync must be idempotent by tx hash. If duplicates already exist, skip
-- the unique index so operators can clean them up explicitly.
do $$
begin
  if not exists (
    select 1
      from game_credit_ledger
     where tx_hash is not null
       and ledger_type = 'AKIBA_TICKET_PURCHASED'
     group by tx_hash
    having count(*) > 1
     limit 1
  ) then
    execute 'create unique index if not exists idx_farkle_ticket_purchase_tx_hash_unique on game_credit_ledger (tx_hash) where tx_hash is not null and ledger_type = ''AKIBA_TICKET_PURCHASED''';
  else
    raise notice 'Skipped idx_farkle_ticket_purchase_tx_hash_unique because duplicate ticket purchase tx_hash rows already exist';
  end if;
end $$;
