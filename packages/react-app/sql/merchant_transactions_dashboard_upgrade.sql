-- merchant_transactions_dashboard_upgrade.sql
-- Adds richer order fields used by the merchant dashboard and backfills
-- the fields that can be derived from the current merchant_transactions schema.
--
-- Run after merchant_order_lifecycle.sql.

alter table merchant_transactions
  add column if not exists product_id text,
  add column if not exists item_name text,
  add column if not exists item_category text,
  add column if not exists amount_cusd double precision,
  add column if not exists amount_kes integer,
  add column if not exists voucher_id uuid,
  add column if not exists voucher_code text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'merchant_transactions'
      and column_name = 'product_id'
      and data_type <> 'text'
  ) then
    alter table merchant_transactions
      alter column product_id type text
      using product_id::text;
  end if;
end $$;

create index if not exists idx_mt_product_id
  on merchant_transactions (product_id)
  where product_id is not null;

create index if not exists idx_mt_voucher_id
  on merchant_transactions (voucher_id)
  where voucher_id is not null;

-- Backfill fields that are derivable from the legacy order shape.
update merchant_transactions
set
  item_category = coalesce(item_category, category::text),
  amount_kes = coalesce(amount_kes, paid_kes::integer),
  amount_cusd = coalesce(amount_cusd, round((paid_kes::numeric / 130.0)::numeric, 2)::double precision)
where
  item_category is null
  or amount_kes is null
  or amount_cusd is null;

-- Existing rows do not have product metadata persisted, so fall back to the
-- stored voucher/action label until fresh orders start writing item_name.
update merchant_transactions
set item_name = coalesce(item_name, voucher::text, 'Merchant order')
where item_name is null;
