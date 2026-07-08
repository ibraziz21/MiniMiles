-- CrackPot chain-anchored fields.
--
-- Adds chain state columns to crackpot_cycles so on-chain cycle IDs are
-- tracked and chain state can be the authoritative source of truth.
--
-- All new columns are nullable so existing rows are unaffected.
-- The one-active-per-version partial-unique index is unchanged — it remains
-- valid for the current single-chain (Celo) deployment. Multi-chain would
-- require adding chain_id to that index; tracked separately.

alter table public.crackpot_cycles
  add column if not exists chain_id          integer,
  add column if not exists contract_cycle_id integer,
  add column if not exists contract_version  integer,
  add column if not exists secret_salt       text,
  add column if not exists secret_commitment text,
  add column if not exists open_tx_hash      text,
  add column if not exists expire_tx_hash    text;

-- Unique index: at most one DB row per on-chain cycle.
-- Partial so existing legacy rows (NULL contract_cycle_id) are not constrained.
create unique index if not exists crackpot_cycles_chain_contract_uniq
  on public.crackpot_cycles (chain_id, contract_version, contract_cycle_id)
  where contract_cycle_id is not null;

-- Fast lookup path for the chain-first sync helper.
create index if not exists crackpot_cycles_chain_version_idx
  on public.crackpot_cycles (chain_id, contract_version, status)
  where status = 'active';
