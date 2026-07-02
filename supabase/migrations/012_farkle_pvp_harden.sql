-- Farkle PvP hardening: atomic matchmaking RPC + reward-credit alignment.
--
-- 1. farkle_enter_match(): replaces the multi-step non-atomic matchmaking logic
--    in the Next.js find route with a single Postgres transaction that:
--      · checks the caller's balance
--      · atomically claims an opponent from the queue (FOR UPDATE SKIP LOCKED)
--      · if no opponent: upserts the caller as "waiting"
--      · if matched: debits both players, creates the match + player rows,
--        inserts ledger entries, and updates queue rows
--    All-or-nothing: any failure rolls back the entire operation.
--
-- 2. Sets winner_reward_credit = 15 (cents = $0.15) for FARKLE_REWARD_3000_USDT,
--    aligning the DB config with the UI display.

-- ── 0. Live-schema compatibility ────────────────────────────────────────────
-- Some live environments already had the Farkle tables before 010 was applied.
-- Because 010 uses CREATE TABLE IF NOT EXISTS, it does not add columns to those
-- older tables. Add the runtime columns this hardening pass reads/writes so the
-- migration and RPC are safe to rerun against both fresh and older schemas.

alter table if exists public.game_matches
  add column if not exists match_key text,
  add column if not exists game_id uuid,
  add column if not exists mode_id uuid,
  add column if not exists status text not null default 'created',
  add column if not exists seed_hash text,
  add column if not exists current_turn_address text,
  add column if not exists turn_number integer not null default 1,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists turn_started_at timestamptz,
  add column if not exists last_action_at timestamptz;

alter table if exists public.game_match_players
  add column if not exists seat_index integer,
  add column if not exists entry_debited boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.game_modes
  add column if not exists winner_reward_credit integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.matchmaking_queue
  add column if not exists status text not null default 'waiting',
  add column if not exists match_id uuid,
  add column if not exists queued_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.farkle_ticket_balances
  add column if not exists balance integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.farkle_credit_balances
  add column if not exists purchased_credits integer not null default 0,
  add column if not exists reward_credits_cents integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.game_credit_ledger
  add column if not exists balance_after integer,
  add column if not exists reference_type text,
  add column if not exists reference_id text;

do $$
begin
  if to_regclass('public.matchmaking_queue') is not null then
    create unique index if not exists matchmaking_queue_wallet_mode_unique_idx
      on public.matchmaking_queue (wallet_address, mode_key);
  end if;
end;
$$;

-- ── 1. Atomic matchmaking function ──────────────────────────────────────────

create or replace function public.farkle_enter_match(
  p_caller      text,         -- session wallet address (lowercase)
  p_mode_key    text,         -- FARKLE_QUICK_1500_AKIBA | FARKLE_REWARD_3000_USDT
  p_target_addr text,         -- nullable: specific opponent wallet to challenge
  p_match_id    uuid,
  p_match_key   text,
  p_seed        text,         -- server seed (stored in match metadata)
  p_seed_hash   text          -- SHA-256 of seed (stored as seed_hash)
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
  -- Get mode config
  select id, game_id
  into v_mode_id, v_game_id
  from public.game_modes
  where mode_key = p_mode_key and active = true;

  if not found then
    return jsonb_build_object('error', 'invalid_mode');
  end if;

  v_is_ticket := (p_mode_key = 'FARKLE_QUICK_1500_AKIBA');

  -- Check caller balance
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

  -- Atomically claim an opponent from the queue.
  -- FOR UPDATE SKIP LOCKED ensures only one concurrent call wins a given row.
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

  -- No opponent found: join (or refresh) the waiting queue
  if v_waiter_addr is null then
    insert into public.matchmaking_queue
      (wallet_address, mode_key, status, match_id, queued_at, expires_at)
    values
      (p_caller, p_mode_key, 'waiting', null, now(), v_expires_at)
    on conflict (wallet_address, mode_key) do update
      set status    = 'waiting',
          match_id  = null,
          queued_at = now(),
          expires_at = excluded.expires_at;

    return jsonb_build_object('status', 'waiting');
  end if;

  -- Atomically debit the waiter (they may have spent credits since queuing)
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
    -- Waiter's balance was depleted; expire their slot and fall back to waiting
    update public.matchmaking_queue
    set status = 'expired', expires_at = now()
    where id = v_waiter_id;

    insert into public.matchmaking_queue
      (wallet_address, mode_key, status, match_id, queued_at, expires_at)
    values
      (p_caller, p_mode_key, 'waiting', null, now(), v_expires_at)
    on conflict (wallet_address, mode_key) do update
      set status    = 'waiting',
          match_id  = null,
          queued_at = now(),
          expires_at = excluded.expires_at;

    return jsonb_build_object('status', 'waiting');
  end if;

  -- Atomically debit the caller (guard against concurrent spend between check and here)
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
    -- Concurrent debit drained caller's balance; restore waiter and report error
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

  -- Create the match record
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

  -- Create player rows (entry already debited above)
  insert into public.game_match_players
    (match_id, wallet_address, seat_index, entry_debited)
  values
    (p_match_id, v_waiter_addr, 0, true),
    (p_match_id, p_caller,      1, true);

  -- Ledger entries for both debits
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

  -- Attach match_id to both queue rows
  update public.matchmaking_queue
  set match_id = p_match_id, expires_at = v_expires_at
  where id = v_waiter_id;

  insert into public.matchmaking_queue
    (wallet_address, mode_key, status, match_id, queued_at, expires_at)
  values
    (p_caller, p_mode_key, 'matched', p_match_id, now(), v_expires_at)
  on conflict (wallet_address, mode_key) do update
    set status    = 'matched',
        match_id  = excluded.match_id,
        expires_at = excluded.expires_at;

  return jsonb_build_object('status', 'matched', 'match_id', p_match_id);
end;
$$;

-- ── 2. Align winner_reward_credit with UI ($0.15 = 15 cents) ────────────────

update public.game_modes
set winner_reward_credit = 15,
    updated_at           = now()
where mode_key = 'FARKLE_REWARD_3000_USDT';
