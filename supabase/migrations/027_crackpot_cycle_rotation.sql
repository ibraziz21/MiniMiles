-- CrackPot cycle rotation hardening.
--
-- 1. Add 'pending' cycle status. The rotation worker now persists the secret
--    preimage (secret_code + secret_salt + commitment + planned expiry) as a
--    'pending' row BEFORE sending openCycle on-chain. After the tx confirms,
--    the row is promoted to 'active' with the chain-assigned cycle id. If the
--    worker dies between the tx and the promotion, any other worker can match
--    the on-chain secretCommitment to the pending row and finish the job —
--    a chain cycle can no longer be stranded without its DB preimage.
--
-- 2. Rotation lock table + claim/release RPCs. Exactly one worker performs
--    expire/open transactions per (chain, contract version); everyone else
--    reads. Implemented as a leased row (not pg advisory locks, which are
--    session-scoped and unreliable through PostgREST connection pooling).

-- ── 1. Widen status check to include 'pending' ────────────────────────────────

alter table public.crackpot_cycles
  drop constraint if exists crackpot_cycles_status_check;

alter table public.crackpot_cycles
  add constraint crackpot_cycles_status_check
  check (status in ('pending', 'active', 'settling', 'cracked', 'dead'));

-- At most one pending (pre-open) cycle per version.
create unique index if not exists crackpot_cycles_one_pending_per_version
  on public.crackpot_cycles (version)
  where status = 'pending';

-- ── 2. Rotation lock ──────────────────────────────────────────────────────────

create table if not exists public.crackpot_rotation_locks (
  lock_key      text        primary key,
  claimed_by    text        not null,
  claimed_until timestamptz not null,
  claimed_at    timestamptz not null default now()
);

alter table public.crackpot_rotation_locks enable row level security;

drop policy if exists crackpot_rotation_locks_deny_all on public.crackpot_rotation_locks;
create policy crackpot_rotation_locks_deny_all on public.crackpot_rotation_locks
  for all using (false);

-- Claim (or re-claim / take over an expired lease). Returns true when the
-- caller now holds the lock, false when another holder's lease is still live.
create or replace function public.crackpot_claim_rotation_lock(
  p_key         text,
  p_holder      text,
  p_ttl_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into crackpot_rotation_locks (lock_key, claimed_by, claimed_until)
  values (p_key, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (lock_key) do update
    set claimed_by    = excluded.claimed_by,
        claimed_until = excluded.claimed_until,
        claimed_at    = now()
    where crackpot_rotation_locks.claimed_until < now()
       or crackpot_rotation_locks.claimed_by = excluded.claimed_by;
  return found;
end;
$$;

-- Release: only the current holder may release its own lease.
create or replace function public.crackpot_release_rotation_lock(
  p_key    text,
  p_holder text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from crackpot_rotation_locks
  where lock_key = p_key
    and claimed_by = p_holder;
end;
$$;

revoke execute on function public.crackpot_claim_rotation_lock(text, text, integer) from public, anon, authenticated;
revoke execute on function public.crackpot_release_rotation_lock(text, text) from public, anon, authenticated;
grant execute on function public.crackpot_claim_rotation_lock(text, text, integer) to service_role;
grant execute on function public.crackpot_release_rotation_lock(text, text) to service_role;
