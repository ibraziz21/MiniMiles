-- 124_native_push_receipts.sql
-- Expo push receipts: did the phone actually get it?
--
-- A ticket from Expo's send endpoint only means Expo accepted the message.
-- Whether Apple/Google then delivered it — or rejected it because the app
-- was uninstalled, or because our APNs/FCM credentials are missing or wrong —
-- is only reported later, as a *receipt* fetched by ticket id. Nothing read
-- receipts, so a missing credential looked exactly like a successful send:
-- every delivery "accepted", nothing arriving.
--
-- 101 already kept provider_ticket "so a later receipt-polling pass" was
-- possible. This adds where that pass writes its answer; the poller is
-- src/lib/push/receipts.ts (/api/internal/process-push-receipts).
--
-- Additive only: nullable columns and a partial index. Existing rows read as
-- "receipt not checked", which is true.

ALTER TABLE native_push_deliveries
  ADD COLUMN IF NOT EXISTS receipt_status text
    CHECK (receipt_status IN ('ok', 'error', 'expired')),
  ADD COLUMN IF NOT EXISTS receipt_error text,
  ADD COLUMN IF NOT EXISTS receipt_checked_at timestamptz;

-- The poller's work queue: accepted sends with a ticket and no receipt yet.
CREATE INDEX IF NOT EXISTS idx_native_push_deliveries_receipt_pending
  ON native_push_deliveries (accepted_at)
  WHERE status = 'accepted' AND provider_ticket IS NOT NULL AND receipt_checked_at IS NULL;
