-- CrackPot attempt hardening.
--
-- Adds chain context columns to crackpot_attempts so that:
--   1. A USDT entry tx maps to exactly ONE attempt (idempotency).
--   2. The specific log within the receipt is recorded for auditability.
--
-- All columns are nullable so existing rows are unaffected.

alter table public.crackpot_attempts
  add column if not exists entry_tx_hash   text,
  add column if not exists chain_id        integer,
  add column if not exists entry_log_index integer;

-- Idempotency key: one attempt per (chain, tx hash).
-- Partial index so legacy rows with no tx hash are not constrained.
create unique index if not exists crackpot_attempts_chain_tx_uniq
  on public.crackpot_attempts (chain_id, entry_tx_hash)
  where entry_tx_hash is not null;
