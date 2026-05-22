-- 008_payout_processing.sql
-- Payout processing metadata written by the admin dashboard after finance
-- completes or rejects a merchant payout.

ALTER TABLE payout_invoices
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_destination_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS payment_tx_hash text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS receipt_number text,
  ADD COLUMN IF NOT EXISTS paid_by_admin_user_id uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_invoices_receipt_number
  ON payout_invoices (receipt_number)
  WHERE receipt_number IS NOT NULL;

COMMENT ON COLUMN payout_invoices.payment_method IS 'wallet, bank, mpesa, or manual payment rail used by AkibaMiles';
COMMENT ON COLUMN payout_invoices.payment_destination_snapshot IS 'Snapshot of merchant payout details used when payout was processed';
COMMENT ON COLUMN payout_invoices.payment_tx_hash IS 'On-chain transaction hash when payout is made on-chain';
COMMENT ON COLUMN payout_invoices.payment_reference IS 'Bank, M-Pesa, or manual payment reference';
COMMENT ON COLUMN payout_invoices.receipt_number IS 'Merchant-facing receipt number generated on successful payout';
COMMENT ON COLUMN payout_invoices.paid_by_admin_user_id IS 'Admin user id that marked this payout paid';
COMMENT ON COLUMN payout_invoices.paid_at IS 'Timestamp when AkibaMiles marked this payout paid';
