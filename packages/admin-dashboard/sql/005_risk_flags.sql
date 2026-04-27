-- Wallet/user risk controls.

create type risk_flag_type as enum (
  'suspicious_activity',
  'blacklisted',
  'rewards_disabled',
  'manual_review'
);

create table if not exists wallet_risk_flags (
  id            uuid primary key default gen_random_uuid(),
  user_address  text not null,
  flag_type     risk_flag_type not null,
  reason        text,
  flagged_by    uuid references admin_users(id) on delete set null,
  resolved_by   uuid references admin_users(id) on delete set null,
  resolved_at   timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists wallet_risk_flags_address_idx on wallet_risk_flags (user_address);
create index if not exists wallet_risk_flags_active_idx  on wallet_risk_flags (is_active) where is_active = true;

create trigger wallet_risk_flags_updated_at
  before update on wallet_risk_flags
  for each row execute function set_updated_at();

-- Internal notes that admins attach to merchants.
create table if not exists merchant_admin_notes (
  id            uuid primary key default gen_random_uuid(),
  partner_id    text not null,            -- references partners.id
  admin_user_id uuid references admin_users(id) on delete set null,
  note          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists merchant_admin_notes_partner_idx on merchant_admin_notes (partner_id, created_at desc);
