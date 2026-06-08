-- crackpot_attempts: support on-chain upsell flow
-- Safe to re-run.

-- Track which enterGame tx funded each upsell pack (prevents replay)
alter table crackpot_attempts
  add column if not exists entry_tx_hash text;

-- Allow "queued" status for pre-purchased paid attempts that haven't started yet
alter table crackpot_attempts
  drop constraint if exists crackpot_attempts_status_check;

alter table crackpot_attempts
  add constraint crackpot_attempts_status_check
  check (status in ('active', 'won', 'expired', 'queued'));

-- Index for quickly finding queued paid attempts per player per cycle
create index if not exists idx_crackpot_attempts_queued_paid
  on crackpot_attempts (cycle_id, player_address, status)
  where status = 'queued' and is_paid = true;
