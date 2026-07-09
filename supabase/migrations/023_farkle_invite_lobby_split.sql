-- Farkle invite/lobby split.
--
-- Public lobby rows are matchable by anyone using "Find Lobby Match".
-- Invite rows are private challenge slots and can only be consumed with the
-- matching invite code. Entries are still only debited when a real match starts.

alter table if exists public.matchmaking_queue
  add column if not exists queue_scope text not null default 'public';

do $$
begin
  alter table public.matchmaking_queue
    add constraint matchmaking_queue_queue_scope_check
    check (queue_scope in ('public', 'invite'));
exception
  when duplicate_object then null;
end;
$$;

-- Rows created by the old invite-code flow had an invite code while still being
-- public. Treat any still-waiting coded rows as private once this migration lands.
update public.matchmaking_queue
set queue_scope = 'invite'
where invite_code is not null
  and status = 'waiting';

create index if not exists matchmaking_queue_waiting_public_idx
  on public.matchmaking_queue (mode_key, queued_at)
  where status = 'waiting' and queue_scope = 'public';

create or replace function public.farkle_enter_match(
  p_caller             text,
  p_mode_key           text,
  p_target_addr        text,
  p_match_id           uuid,
  p_match_key          text,
  p_seed               text,
  p_seed_hash          text,
  p_invite_code        text default null,
  p_queue_scope        text default 'public',
  p_target_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode_id            uuid;
  v_game_id            uuid;
  v_entry_amount       integer := 1;
  v_waiter_id          uuid;
  v_waiter_addr        text;
  v_caller_bal         integer;
  v_new_bal_waiter     integer;
  v_new_bal_caller     integer;
  v_expires_at         timestamptz := now() + interval '120 seconds';
  v_is_ticket          boolean;
  v_queue_scope        text := case when lower(coalesce(p_queue_scope, 'public')) = 'invite' then 'invite' else 'public' end;
  v_invite_code        text := nullif(upper(trim(coalesce(p_invite_code, ''))), '');
  v_target_invite_code text := nullif(upper(trim(coalesce(p_target_invite_code, ''))), '');
begin
  select id, game_id, greatest(coalesce(entry_amount, 1), 1)
  into v_mode_id, v_game_id, v_entry_amount
  from public.game_modes
  where mode_key = p_mode_key and active = true;

  if not found then
    return jsonb_build_object('error', 'invalid_mode');
  end if;

  if v_queue_scope = 'invite' and v_invite_code is null and p_target_addr is null then
    return jsonb_build_object('error', 'missing_invite_code');
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
      and (
        (v_target_invite_code is not null and queue_scope = 'invite' and invite_code = v_target_invite_code)
        or
        (v_target_invite_code is null and queue_scope = 'public')
      )
    returning id, wallet_address into v_waiter_id, v_waiter_addr;
  elsif v_queue_scope = 'public' then
    update public.matchmaking_queue mq
    set status = 'matched', expires_at = v_expires_at
    from (
      select id
      from public.matchmaking_queue
      where mode_key       = p_mode_key
        and status         = 'waiting'
        and queue_scope    = 'public'
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
      (wallet_address, mode_key, status, match_id, queued_at, expires_at, invite_code, queue_scope)
    values
      (
        p_caller,
        p_mode_key,
        'waiting',
        null,
        now(),
        v_expires_at,
        case when v_queue_scope = 'invite' then v_invite_code else null end,
        v_queue_scope
      )
    on conflict (wallet_address, mode_key) do update
      set status      = 'waiting',
          match_id    = null,
          queued_at   = now(),
          expires_at  = excluded.expires_at,
          invite_code = excluded.invite_code,
          queue_scope = excluded.queue_scope;

    return jsonb_build_object(
      'status',
      'waiting',
      'invite_code',
      case when v_queue_scope = 'invite' then v_invite_code else null end
    );
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
      (wallet_address, mode_key, status, match_id, queued_at, expires_at, invite_code, queue_scope)
    values
      (
        p_caller,
        p_mode_key,
        'waiting',
        null,
        now(),
        v_expires_at,
        case when v_queue_scope = 'invite' then v_invite_code else null end,
        v_queue_scope
      )
    on conflict (wallet_address, mode_key) do update
      set status      = 'waiting',
          match_id    = null,
          queued_at   = now(),
          expires_at  = excluded.expires_at,
          invite_code = excluded.invite_code,
          queue_scope = excluded.queue_scope;

    return jsonb_build_object(
      'status',
      'waiting',
      'invite_code',
      case when v_queue_scope = 'invite' then v_invite_code else null end
    );
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
