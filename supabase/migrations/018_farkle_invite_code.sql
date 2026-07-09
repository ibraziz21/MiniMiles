-- 018_farkle_invite_code.sql
-- Adds invite_code to matchmaking_queue so waiting players can share a short
-- code (e.g. FARK-A7X2) that a friend enters to join their specific lobby slot.

alter table public.matchmaking_queue
  add column if not exists invite_code text;

-- Partial unique index: two active waiting slots can't share a code,
-- but expired/matched rows are allowed to reuse codes without conflict.
create unique index if not exists matchmaking_queue_invite_code_unique
  on public.matchmaking_queue (invite_code)
  where invite_code is not null and status = 'waiting';

-- Re-create farkle_enter_match with p_invite_code so the code is stored
-- atomically with the queue insert (avoids a read-modify-write race).
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
  v_waiter_id      uuid;
  v_waiter_addr    text;
  v_caller_bal     integer;
  v_new_bal_waiter integer;
  v_new_bal_caller integer;
  v_expires_at     timestamptz := now() + interval '120 seconds';
  v_is_ticket      boolean;
begin
  select id, game_id
  into v_mode_id, v_game_id
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

    if coalesce(v_caller_bal, 0) < 1 then
      return jsonb_build_object('error', 'insufficient_tickets');
    end if;
  else
    select purchased_credits into v_caller_bal
    from public.farkle_credit_balances
    where wallet_address = p_caller;

    if coalesce(v_caller_bal, 0) < 1 then
      return jsonb_build_object('error', 'insufficient_credits');
    end if;
  end if;

  if p_target_addr is not null then
    update public.matchmaking_queue
    set status = 'matched', expires_at = v_expires_at
    where wallet_address = p_target_addr
      and mode_key       = p_mode_key
      and status         = 'waiting'
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
    set balance = balance - 1, updated_at = now()
    where wallet_address = v_waiter_addr and balance >= 1
    returning balance into v_new_bal_waiter;
  else
    update public.farkle_credit_balances
    set purchased_credits = purchased_credits - 1, updated_at = now()
    where wallet_address = v_waiter_addr and purchased_credits >= 1
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
    set balance = balance - 1, updated_at = now()
    where wallet_address = p_caller and balance >= 1
    returning balance into v_new_bal_caller;
  else
    update public.farkle_credit_balances
    set purchased_credits = purchased_credits - 1, updated_at = now()
    where wallet_address = p_caller and purchased_credits >= 1
    returning purchased_credits into v_new_bal_caller;
  end if;

  if v_new_bal_caller is null then
    if v_is_ticket then
      update public.farkle_ticket_balances
      set balance = balance + 1, updated_at = now()
      where wallet_address = v_waiter_addr;
    else
      update public.farkle_credit_balances
      set purchased_credits = purchased_credits + 1, updated_at = now()
      where wallet_address = v_waiter_addr;
    end if;

    update public.matchmaking_queue
    set status = 'waiting', expires_at = v_expires_at
    where id = v_waiter_id;

    return jsonb_build_object('error', 'insufficient_balance_retry');
  end if;

  insert into public.game_matches (
    id, match_key, game_id, mode_id, status, seed_hash,
    current_turn_address, turn_number, metadata,
    started_at, turn_started_at, last_action_at
  ) values (
    p_match_id, p_match_key, v_game_id, v_mode_id, 'in_progress', p_seed_hash,
    v_waiter_addr, 1,
    jsonb_build_object('seed', p_seed, 'modeKey', p_mode_key),
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
      (v_waiter_addr, -1, v_new_bal_waiter, 'AKIBA_TICKET', 'AKIBA_TICKET_DEBITED', 'match', p_match_id::text),
      (p_caller,      -1, v_new_bal_caller, 'AKIBA_TICKET', 'AKIBA_TICKET_DEBITED', 'match', p_match_id::text);
  else
    insert into public.game_credit_ledger
      (wallet_address, amount, balance_after, currency, ledger_type, reference_type, reference_id)
    values
      (v_waiter_addr, -1, v_new_bal_waiter, 'GAME_CREDIT', 'GAME_CREDIT_DEBITED', 'match', p_match_id::text),
      (p_caller,      -1, v_new_bal_caller, 'GAME_CREDIT', 'GAME_CREDIT_DEBITED', 'match', p_match_id::text);
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
