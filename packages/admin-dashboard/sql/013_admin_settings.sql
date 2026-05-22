-- 013_admin_settings.sql
-- Admin-dashboard account policy and operational settings.

alter table admin_users
  add column if not exists must_change_password boolean not null default false;

create table if not exists admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function set_admin_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_settings_updated_at on admin_settings;
create trigger admin_settings_updated_at
  before update on admin_settings
  for each row execute function set_admin_settings_updated_at();

insert into admin_settings (key, value, description)
values
  (
    'security',
    '{
      "passwordMinLength": 12,
      "sessionTimeoutMinutes": 480,
      "loginLockoutMaxFailures": 5,
      "loginLockoutMinutes": 15,
      "requireTempPasswordReset": true
    }'::jsonb,
    'Admin login, password, and session policy'
  ),
  (
    'finance',
    '{
      "receiptPrefix": "AKB-RCPT",
      "payoutApprovalThreshold": 0,
      "enabledPayoutMethods": ["wallet", "bank", "mpesa"],
      "requireTxHashForWallet": true,
      "businessName": "AkibaMiles",
      "businessEmail": "",
      "businessPhone": "",
      "businessAddress": ""
    }'::jsonb,
    'Payout and merchant receipt defaults'
  ),
  (
    'notifications',
    '{
      "financeAlertEmail": "",
      "opsAlertEmail": "",
      "supportEmail": ""
    }'::jsonb,
    'Admin notification recipients'
  )
on conflict (key) do nothing;
