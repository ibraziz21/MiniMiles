-- CrackPot orphaned paid entries.
--
-- A player can pay the entry fee (EntryRecorded lands on-chain in cycle N)
-- but reach /api/crackpot/attempt/start only after the cycle has rotated to
-- N+1 — or with so little time left in the cycle that no guess is playable.
-- Previously that entry was silently rejected with a 422 and the fee was
-- lost. Now the entry is recorded here for reconciliation (credit / refund)
-- and the player gets an explicit response.
--
-- status lifecycle: recorded → credited | refunded | dismissed
-- (resolution is manual / via an admin job; this table is the audit trail).

create table if not exists public.crackpot_orphaned_entries (
  id                uuid        primary key default gen_random_uuid(),
  chain_id          integer     not null,
  tx_hash           text        not null,
  log_index         integer,
  player_address    text        not null,
  version           text        not null,
  -- Cycle the entry actually recorded into on-chain (from the EntryRecorded event).
  contract_cycle_id integer,
  -- Raw on-chain entry amount as a decimal string (18-dec Miles / 6-dec USDT).
  entry_amount      text,
  reason            text        not null
                      check (reason in ('cycle_rotated', 'entry_too_late')),
  status            text        not null default 'recorded'
                      check (status in ('recorded', 'credited', 'refunded', 'dismissed')),
  resolution_note   text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),

  constraint crackpot_orphaned_entries_tx_uniq unique (chain_id, tx_hash)
);

create index if not exists crackpot_orphaned_entries_unresolved_idx
  on public.crackpot_orphaned_entries (status, created_at)
  where status = 'recorded';

create index if not exists crackpot_orphaned_entries_player_idx
  on public.crackpot_orphaned_entries (player_address);

alter table public.crackpot_orphaned_entries enable row level security;

drop policy if exists crackpot_orphaned_entries_deny_all on public.crackpot_orphaned_entries;
create policy crackpot_orphaned_entries_deny_all on public.crackpot_orphaned_entries
  for all using (false);
