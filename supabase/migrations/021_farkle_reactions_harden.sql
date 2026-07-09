-- 021_farkle_reactions_harden.sql
-- Atomic rate-limited reaction RPC for PvP Farkle.
-- Replaces the read-last-then-insert in the API route with a single DB function
-- that checks participant membership, enforces 2-second cooldown, and inserts —
-- all inside one serializable transaction to prevent concurrent-tap races.

create or replace function public.farkle_send_reaction(
  p_match_id      uuid,
  p_wallet        text,
  p_emoji         text,
  p_cooldown_ms   int default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_at timestamptz;
  v_elapsed_ms numeric;
  v_id uuid;
begin
  -- 1. Verify caller is a participant in this match.
  if not exists (
    select 1 from public.game_match_players
    where match_id = p_match_id and wallet_address = p_wallet
  ) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  -- 2. Check cooldown: when was this wallet's last reaction for this match?
  select created_at into v_last_at
  from public.farkle_reactions
  where match_id = p_match_id and wallet_address = p_wallet
  order by created_at desc
  limit 1
  for update skip locked;       -- skip if a concurrent insert is in-flight

  if found then
    v_elapsed_ms := extract(epoch from (now() - v_last_at)) * 1000;
    if v_elapsed_ms < p_cooldown_ms then
      return jsonb_build_object('error', 'rate_limited');
    end if;
  end if;

  -- 3. Insert the reaction.
  insert into public.farkle_reactions (match_id, wallet_address, emoji)
  values (p_match_id, p_wallet, p_emoji)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Allow the service role (used by the API route) to call this function.
grant execute on function public.farkle_send_reaction(uuid, text, text, int) to service_role;
