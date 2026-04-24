-- auth_rate_limit.sql
-- Tracks failed login attempts per email for the merchant dashboard.
-- Run once. Safe to re-run.

create table if not exists auth_login_attempts (
  email        text        not null primary key,
  failures     integer     not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_ala_locked_until
  on auth_login_attempts (locked_until)
  where locked_until is not null;
