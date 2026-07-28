-- issued_vouchers_linked_product_columns.sql
-- Fixes a standing, pre-existing bug unrelated to the weekly leaderboard
-- challenge work: app/api/Spend/vouchers/issue/route.ts writes
-- linked_product_id/product_name/product_image_url onto issued_vouchers when
-- promoting a Hub Miles Purchase voucher to 'issued', and app/vouchers/page.tsx
-- reads all three directly off the top-level voucher object to render the
-- "specific product included" card. Neither column has ever existed on
-- issued_vouchers (confirmed via information_schema.columns) — this is on
-- main too, not a branch-divergence artifact, so any real customer
-- purchasing a product-linked voucher should already be hitting
-- "column ... does not exist" at promote-to-issued time.
--
-- linked_product_id is text (matches spend_voucher_templates.linked_product_id's
-- actual type, confirmed via information_schema — not uuid).
--
-- Idempotent: safe to re-run.

alter table issued_vouchers
  add column if not exists linked_product_id text,
  add column if not exists product_name      text,
  add column if not exists product_image_url text;
