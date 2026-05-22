-- auth_invite_tokens.sql
-- Stores time-limited tokens for merchant user invite and password reset flows.
-- Run once. Safe to re-run.

create table if not exists auth_invite_tokens (
  id           uuid        primary key default gen_random_uuid(),
  token        text        not null unique,
  email        text        not null,
  partner_id   uuid        not null references partners(id) on delete cascade,
  type         text        not null check (type in ('invite', 'password_reset')),
  role         text        not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  used         boolean     not null default false,
  expires_at   timestamptz not null,
  created_by   uuid        references merchant_users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ait_token  on auth_invite_tokens (token);
create index if not exists idx_ait_email  on auth_invite_tokens (email);
create index if not exists idx_ait_expiry on auth_invite_tokens (expires_at) where not used;
