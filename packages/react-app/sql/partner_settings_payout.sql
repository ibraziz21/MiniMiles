-- partner_settings_payout.sql
-- Adds merchant payout wallet and KES exchange rate to partner_settings.

alter table partner_settings
  add column if not exists payout_wallet     text,
  add column if not exists kes_exchange_rate numeric(10,4) default 130;

comment on column partner_settings.payout_wallet     is 'Merchant wallet address that receives payouts';
comment on column partner_settings.kes_exchange_rate is 'KES per 1 USD exchange rate used for this merchant — overrides system default of 130';
