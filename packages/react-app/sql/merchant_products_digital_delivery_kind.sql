-- merchant_products_digital_delivery_kind.sql
-- See docs/voucher-merchant-checkout-spec.md §3.
--
-- merchant_products.product_type ('physical'|'digital') already exists on
-- this shared table (confirmed live via information_schema — hub-page
-- already established it). This adds one new, more granular column that
-- doesn't exist anywhere yet: for a digital product, which delivery
-- destination the checkout should collect. Nullable — only meaningful when
-- product_type = 'digital'.
--
-- Idempotent: safe to re-run.

alter table merchant_products
  add column if not exists digital_delivery_kind text;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'merchant_products' and constraint_name = 'chk_mp_digital_delivery_kind'
  ) then
    alter table merchant_products
      add constraint chk_mp_digital_delivery_kind
      check (digital_delivery_kind is null or digital_delivery_kind in ('airtime_topup', 'code_delivery'));
  end if;
end;
$$;
