-- 011_payout_processing.sql
-- Payout processing metadata for admin-dashboard finance operations.
-- Idempotent with merchant-dashboard/sql/008_payout_processing.sql.

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
