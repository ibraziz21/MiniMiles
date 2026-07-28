-- Phase 0 containment — one-off operational script, NOT a migration.
-- Run each section manually against the sandbox and read the output before
-- acting; none of this should be run unattended.

-- ── 1. Find confirmed payments with no order (the "orphaned money" case) ───
-- Each row here is a verified payment whose order creation failed. For each:
--   - if the customer's fulfillment details are known/recoverable, create the
--     order manually via place_hub_order_and_redeem_voucher with the same
--     payment_ref (idempotent — a repeat payment_ref is rejected, so this is
--     safe to attempt even if partially retried already), or
--   - if the product/voucher context can't be reconstructed safely, refund
--     the payment and mark the incident resolved via resolve_reconciliation_incident.
SELECT id, type, voucher_id, data, created_at
FROM reconciliation_incidents
WHERE type = 'order_rpc_failed_after_payment'
  AND resolved = false
ORDER BY created_at;

-- ── 2. List currently-active digital products (to confirm which two, and ─
--       review before deactivating) ────────────────────────────────────────
SELECT id, merchant_id, name, category, product_type, active
FROM merchant_products
WHERE product_type = 'digital' AND active = true
ORDER BY created_at;

-- ── 3. Deactivate all active digital products ───────────────────────────────
-- Run only after confirming the list above is what you expect to pause.
-- UPDATE merchant_products SET active = false WHERE product_type = 'digital' AND active = true;

-- ── 4. Verify the gate: every confirmed payment has an order or a tracked refund ─
-- Should return zero rows once section 1's incidents are resolved.
SELECT id, type, data, created_at
FROM reconciliation_incidents
WHERE type = 'order_rpc_failed_after_payment' AND resolved = false;
