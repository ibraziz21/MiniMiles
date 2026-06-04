-- voucher_template_product_link.sql
-- Adds product-level fields to spend_voucher_templates:
--   linked_product_id  — optional FK to merchant_products.id
--   retail_value_cusd  — retail price shown to the customer (display & accounting)
--   wholesale_price_cusd — cost/wholesale price for merchant margin calculations

alter table spend_voucher_templates
  add column if not exists linked_product_id  text,
  add column if not exists retail_value_cusd  numeric(10,4),
  add column if not exists wholesale_price_cusd numeric(10,4);

comment on column spend_voucher_templates.linked_product_id    is 'Optional FK to merchant_products.id — links this voucher to a specific product listing';
comment on column spend_voucher_templates.retail_value_cusd    is 'Retail/face value of the voucher in USD — used for display and margin accounting';
comment on column spend_voucher_templates.wholesale_price_cusd is 'Merchant cost/wholesale price in USD — used internally for margin calculations; never exposed to customers';

create index if not exists idx_svt_linked_product
  on spend_voucher_templates (linked_product_id)
  where linked_product_id is not null;
