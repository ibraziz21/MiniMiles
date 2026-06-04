-- 007_product_voucher_enforcement.sql
-- Wires per-product vouchers end-to-end.
--
-- Changes:
--   1. Proper FK on spend_voucher_templates.linked_product_id → merchant_products.id
--      (was just a text column with no constraint before)
--   2. Add product_name + product_image_url denorm columns to issued_vouchers
--      so the user-facing wallet can display product info without extra joins.
--   3. Add linked_product_id to issued_vouchers for fast enforcement at redemption.
--
-- Safe to re-run (all statements use IF NOT EXISTS / IF EXISTS guards).

-- ── 1. Fix linked_product_id type & FK on spend_voucher_templates ─────────────
-- The column was added as text in voucher_template_product_link.sql.
-- Cast to uuid and add a real FK.  USING handles existing NULL values safely.

ALTER TABLE spend_voucher_templates
  ALTER COLUMN linked_product_id TYPE uuid
    USING linked_product_id::uuid;

ALTER TABLE spend_voucher_templates
  DROP CONSTRAINT IF EXISTS fk_svt_linked_product;

ALTER TABLE spend_voucher_templates
  ADD CONSTRAINT fk_svt_linked_product
    FOREIGN KEY (linked_product_id)
    REFERENCES merchant_products(id)
    ON DELETE SET NULL;

-- When a voucher is product-linked, applicable_category must be NULL (enforced by app,
-- but add a check constraint as a safety net).
ALTER TABLE spend_voucher_templates
  DROP CONSTRAINT IF EXISTS chk_svt_product_xor_category;

ALTER TABLE spend_voucher_templates
  ADD CONSTRAINT chk_svt_product_xor_category
    CHECK (linked_product_id IS NULL OR applicable_category IS NULL);

-- ── 2. Denorm product info onto issued_vouchers ───────────────────────────────
-- Stored at issue time so wallet display never needs a join.

ALTER TABLE issued_vouchers
  ADD COLUMN IF NOT EXISTS linked_product_id  uuid    REFERENCES merchant_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_name       text,
  ADD COLUMN IF NOT EXISTS product_image_url  text;

CREATE INDEX IF NOT EXISTS idx_iv_linked_product
  ON issued_vouchers (linked_product_id)
  WHERE linked_product_id IS NOT NULL;
