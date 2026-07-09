-- Farkle Pro Reward Duel.
--
-- Adds a higher-stakes USDT reward mode while keeping the same credit model:
--   - buy credits through GameCreditVault
--   - spend 10 credits per Pro match
--   - first to 5,000 points
--   - winner receives 185 cents of reward credit
--
-- The matchmaking RPC is recreated so entry_amount is authoritative for all
-- balance checks, debits, ledger entries, and rollback refunds.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id         uuid primary key default gen_random_uuid(),
  game_key   text not null unique,
  name       text not null,
  status     text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.game_modes (
  id                   uuid primary key default gen_random_uuid(),
  game_id              uuid,
  mode_key             text not null unique,
  name                 text not null default 'Farkle Mode',
  display_name         text not null,
  target_score         integer not null,
  entry_type           text not null default 'GAME_CREDIT',
  entry_currency       text not null,
  entry_amount         integer not null default 1,
  winner_miles_reward  integer not null default 10,
  loser_miles_reward   integer not null default 5,
  winner_reward_credit integer not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

alter table if exists public.game_modes
  add column if not exists game_id uuid,
  add column if not exists mode_key text,
  add column if not exists name text not null default 'Farkle Mode',
  add column if not exists display_name text not null default 'Farkle Mode',
  add column if not exists target_score integer not null default 1500,
  add column if not exists entry_type text not null default 'GAME_CREDIT',
  add column if not exists entry_currency text not null default 'GAME_CREDIT',
  add column if not exists entry_amount integer not null default 1,
  add column if not exists winner_miles_reward integer not null default 10,
  add column if not exists loser_miles_reward integer not null default 5,
  add column if not exists winner_reward_credit integer not null default 0,
  add column if not exists active boolean not null default true;

alter table if exists public.game_matches
  add column if not exists server_seed text;

alter table if exists public.matchmaking_queue
  add column if not exists invite_code text;

do $$
declare
  v_game_id uuid;
begin
  select id
  into v_game_id
  from public.games
  where lower(game_key) = 'farkle'
  order by created_at asc nulls last
  limit 1;

  if v_game_id is null then
    insert into public.games (game_key, name, status)
    values ('FARKLE', 'Farkle Duel', 'active')
    returning id into v_game_id;
  end if;

  update public.game_modes
  set game_id = v_game_id,
      name = 'Pro Duel',
      display_name = 'Pro Duel',
      target_score = 5000,
      entry_type = 'GAME_CREDIT',
      entry_currency = 'GAME_CREDIT',
      entry_amount = 10,
      winner_miles_reward = 10,
      loser_miles_reward = 5,
      winner_reward_credit = 185,
      active = true
  where mode_key = 'FARKLE_PRO_5000_USDT';

  if not found then
    insert into public.game_modes (
      game_id,
      mode_key,
      name,
      display_name,
      target_score,
      entry_type,
      entry_currency,
      entry_amount,
      winner_miles_reward,
      loser_miles_reward,
      winner_reward_credit,
      active
    )
    values (
      v_game_id,
      'FARKLE_PRO_5000_USDT',
      'Pro Duel',
      'Pro Duel',
      5000,
      'GAME_CREDIT',
      'GAME_CREDIT',
      10,
      10,
      5,
      185,
      true
    );
  end if;
end;
$$;

create or replace function public.farkle_enter_match(
  p_caller      text,
  p_mode_key    text,
  p_target_addr text,
  p_match_id    uuid,
  p_match_key   text,
  p_seed        text,
  p_seed_hash   text,
  p_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode_id        uuid;
  v_game_id        uuid;
  v_entry_amount   integer := 1;
  v_waiter_id      uuid;
  v_waiter_addr    text;
  v_caller_bal     integer;
  v_new_bal_waiter integer;
  v_new_bal_caller integer;
  v_expires_at     timestamptz := now() + interval '120 seconds';
  v_is_ticket      boolean;
begin
  select id, game_id, greatest(coalesce(entry_amount, 1), 1)
  into v_mode_id, v_game_id, v_entry_amount
  from public.game_modes
  where mode_key = p_mode_key and active = true;

  if not found then
    return jsonb_build_object('error', 'invalid_mode');
  end if;

  v_is_ticket := (p_mode_key = 'FARKLE_QUICK_1500_AKIBA');

  if v_is_ticket then
    select balance into v_caller_bal
    from public.farkle_ticket_balances
    where wallet_address = p_caller;

    if coalesce(v_caller_bal, 0) < v_entry_amount then
      return jsonb_build_object('error', 'insufficient_tickets', 'required', v_entry_amount);
    end if;
  else
    select purchased_credits into v_caller_bal
    from public.farkle_credit_balances
    where wallet_address = p_caller;

    if coalesce(v_caller_bal, 0) < v_entry_amount then
      return jsonb_build_object('error', 'insufficient_credits', 'required', v_entry_amount);
    end if;
  end if;

  if p_target_addr is not null then
    update public.matchmaking_queue
    set status = 'matched', expires_at = v_expires_at
    where wallet_address = p_target_addr
      and mode_key       = p_mode_key
      and status         = 'waiting'
      and expires_at     > now()
      and wallet_address <> p_caller
    returning id, wallet_address into v_waiter_id, v_waiter_addr;
  else
    update public.matchmaking_queue mq
    set status = 'matched', expires_at = v_expires_at
    from (
      select id
      from public.matchmaking_queue
      where mode_key       = p_mode_key
        and status         = 'waiting'
        and wallet_address <> p_caller
        and expires_at     > now()
      order by queued_at asc
      limit 1
      for update skip locked
    ) sub
    where mq.id = sub.id
    returning mq.id, mq.wallet_address into v_waiter_id, v_waiter_addr;
  end if;

  if v_waiter_addr is null then
    insert into public.matchmaking_queue
      (wallet_address, mode_key, status, match_id, queued_at, expires_at, invite_code)
    values
      (p_caller, p_mode_key, 'waiting', null, now(), v_expires_at, p_invite_code)
    on conflict (wallet_address, mode_key) do update
      set status      = 'waiting',
          match_id    = null,
          queued_at   = now(),
          expires_at  = excluded.expires_at,
          invite_code = excluded.invite_code;

    return jsonb_build_object('status', 'waiting');
  end if;

  if v_is_ticket then
    update public.farkle_ticket_balances
    set balance = balance - v_entry_amount, updated_at = now()
    where wallet_address = v_waiter_addr and balance >= v_entry_amount
    returning balance into v_new_bal_waiter;
  else
    update public.farkle_credit_balances
    set purchased_credits = purchased_credits - v_entry_amount, updated_at = now()
    where wallet_address = v_waiter_addr and purchased_credits >= v_entry_amount
    returning purchased_credits into v_new_bal_waiter;
  end if;

  if v_new_bal_waiter is null then
    update public.matchmaking_queue
    set status = 'expired', expires_at = now()
    where id = v_waiter_id;

    insert into public.matchmaking_queue
      (wallet_address, mode_key, status, match_id, queued_at, expires_at, invite_code)
    values
      (p_caller, p_mode_key, 'waiting', null, now(), v_expires_at, p_invite_code)
    on conflict (wallet_address, mode_key) do update
      set status      = 'waiting',
          match_id    = null,
          queued_at   = now(),
          expires_at  = excluded.expires_at,
          invite_code = excluded.invite_code;

    return jsonb_build_object('status', 'waiting');
  end if;

  if v_is_ticket then
    update public.farkle_ticket_balances
    set balance = balance - v_entry_amount, updated_at = now()
    where wallet_address = p_caller and balance >= v_entry_amount
    returning balance into v_new_bal_caller;
  else
    update public.farkle_credit_balances
    set purchased_credits = purchased_credits - v_entry_amount, updated_at = now()
    where wallet_address = p_caller and purchased_credits >= v_entry_amount
    returning purchased_credits into v_new_bal_caller;
  end if;

  if v_new_bal_caller is null then
    if v_is_ticket then
      update public.farkle_ticket_balances
      set balance = balance + v_entry_amount, updated_at = now()
      where wallet_address = v_waiter_addr;
    else
      update public.farkle_credit_balances
      set purchased_credits = purchased_credits + v_entry_amount, updated_at = now()
      where wallet_address = v_waiter_addr;
    end if;

    update public.matchmaking_queue
    set status = 'waiting', expires_at = v_expires_at
    where id = v_waiter_id;

    return jsonb_build_object(
      'error',
      'insufficient_balance_retry',
      'required',
      v_entry_amount
    );
  end if;

  insert into public.game_matches (
    id, match_key, game_id, mode_id, status, seed_hash, server_seed,
    current_turn_address, turn_number, metadata,
    started_at, turn_started_at, last_action_at
  ) values (
    p_match_id, p_match_key, v_game_id, v_mode_id, 'in_progress', p_seed_hash, p_seed,
    v_waiter_addr, 1,
    jsonb_build_object('modeKey', p_mode_key),
    now(), now(), now()
  );

  insert into public.game_match_players
    (match_id, wallet_address, seat_index, entry_debited)
  values
    (p_match_id, v_waiter_addr, 0, true),
    (p_match_id, p_caller,      1, true);

  if v_is_ticket then
    insert into public.game_credit_ledger
      (wallet_address, amount, balance_after, currency, ledger_type, reference_type, reference_id)
    values
      (v_waiter_addr, -v_entry_amount, v_new_bal_waiter, 'AKIBA_TICKET', 'AKIBA_TICKET_DEBITED', 'match', p_match_id::text),
      (p_caller,      -v_entry_amount, v_new_bal_caller, 'AKIBA_TICKET', 'AKIBA_TICKET_DEBITED', 'match', p_match_id::text);
  else
    insert into public.game_credit_ledger
      (wallet_address, amount, balance_after, currency, ledger_type, reference_type, reference_id)
    values
      (v_waiter_addr, -v_entry_amount, v_new_bal_waiter, 'GAME_CREDIT', 'GAME_CREDIT_DEBITED', 'match', p_match_id::text),
      (p_caller,      -v_entry_amount, v_new_bal_caller, 'GAME_CREDIT', 'GAME_CREDIT_DEBITED', 'match', p_match_id::text);
  end if;

  update public.matchmaking_queue
  set match_id = p_match_id, expires_at = v_expires_at
  where id in (v_waiter_id);

  update public.matchmaking_queue
  set match_id = p_match_id, status = 'matched', expires_at = v_expires_at
  where wallet_address = p_caller and mode_key = p_mode_key;

  return jsonb_build_object('status', 'matched', 'match_id', p_match_id);
end;
$$;
