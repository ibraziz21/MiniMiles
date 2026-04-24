-- merchant_category_enum_fix.sql
-- Fixes order inserts for merchant product categories when the legacy
-- merchant_transactions.category column is typed as tx_category.
--
-- New order code writes rich product categories into item_category and keeps
-- category as a stable legacy bucket, but this migration also expands the enum
-- so existing/manual inserts do not fail on current product categories.

ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'general';
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'electronics';
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'accessories';
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'services';
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'clothing';
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'food';
