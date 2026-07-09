-- 017_farkle_ledger_idempotent.sql
-- Adds a unique constraint on game_credit_ledger so that concurrent settlement
-- paths (inline + reconcile sweep) cannot produce duplicate reward entries for
-- the same match. The backend upsert uses ON CONFLICT DO NOTHING, making
-- writeRewardLedger idempotent without a separate SELECT guard.

create unique index if not exists game_credit_ledger_match_reward_unique
  on public.game_credit_ledger (reference_type, reference_id, ledger_type, wallet_address);
