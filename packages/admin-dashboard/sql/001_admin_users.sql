-- Admin users for the internal AkibaMiles admin dashboard.
-- Completely separate from merchant_users.

create type admin_role as enum (
  'super_admin',
  'ops_admin',
  'finance_admin',
  'insights_admin',
  'readonly'
);

create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text,
  role          admin_role not null default 'readonly',
  is_active     boolean not null default true,
  created_by    uuid references admin_users(id) on delete set null,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists admin_users_email_idx on admin_users (email);

-- Keep updated_at current
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger admin_users_updated_at
  before update on admin_users
  for each row execute function set_updated_at();

-- Rate-limit table for admin login attempts
create table if not exists admin_login_attempts (
  email        text primary key,
  failure_count int not null default 0,
  locked_until  timestamptz,
  last_attempt  timestamptz not null default now()
);
