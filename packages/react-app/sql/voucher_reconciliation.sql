-- voucher_reconciliation.sql
-- Adds columns to issued_vouchers needed for durable burn/promote reconciliation.
-- Also documents the reconciliation query for the ops/support team.
--
-- Run once in the Supabase SQL editor after reserve_voucher_atomic.sql.

-- ── 1. Add burn_tx_hash column ─────────────────────────────────────────────────
-- Stores the on-chain burn transaction hash once the burn is confirmed.
-- Written by the issue route before/during promote. If promote fails,
-- the hash is still present so a recovery job can re-attempt the promote.
ALTER TABLE issued_vouchers
  ADD COLUMN IF NOT EXISTS burn_tx_hash text;

-- ── 2. Add recovery_state column ──────────────────────────────────────────────
-- Tracks structured recovery state for rows that need reconciliation.
-- Possible values (null = normal flow):
--   'burn_confirmed_promote_failed'  — burn is on-chain, DB promote failed
-- A background job or support query uses this column to find affected rows.
ALTER TABLE issued_vouchers
  ADD COLUMN IF NOT EXISTS recovery_state text
    CHECK (recovery_state IS NULL OR recovery_state = 'burn_confirmed_promote_failed');

-- ── 3. Index for fast reconciliation queries ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_iv_recovery_state
  ON issued_vouchers (recovery_state)
  WHERE recovery_state IS NOT NULL;

-- Index for pending rows older than a threshold (cleanup job)
CREATE INDEX IF NOT EXISTS idx_iv_pending_created
  ON issued_vouchers (created_at)
  WHERE status = 'pending';


-- ── 4. Reconciliation queries ──────────────────────────────────────────────────
-- Run these in the Supabase SQL editor or from a scheduled cron job.

-- (A) Find rows where burn succeeded but promote failed — promote them now.
--     Safe to run repeatedly (WHERE status = 'pending' is idempotent).
--
-- UPDATE issued_vouchers
--    SET status = 'issued',
--        recovery_state = NULL
--  WHERE recovery_state = 'burn_confirmed_promote_failed'
--    AND status = 'pending'
--    AND burn_tx_hash IS NOT NULL;
--
-- After running: verify each voucher's burn_tx_hash on-chain before promoting
-- if you want extra certainty. The route already checked it was confirmed,
-- so this is safe to run as-is.


-- (B) Expire stale pending rows that never received a burn (e.g. process killed
--     before burn started, or burn failed silently without voiding the row).
--     Threshold: 30 minutes — well beyond any normal burn timeout (60s).
--
-- UPDATE issued_vouchers
--    SET status = 'void'
--  WHERE status = 'pending'
--    AND recovery_state IS NULL
--    AND burn_tx_hash IS NULL
--    AND created_at < now() - interval '30 minutes';


-- (C) Find pending rows that may need attention (ops dashboard query):
--
-- SELECT id, user_address, voucher_template_id, code, burn_tx_hash,
--        recovery_state, created_at,
--        EXTRACT(EPOCH FROM (now() - created_at)) / 60 AS age_minutes
--   FROM issued_vouchers
--  WHERE status = 'pending'
--  ORDER BY created_at;
