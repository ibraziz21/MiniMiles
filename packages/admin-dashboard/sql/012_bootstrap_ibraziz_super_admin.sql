-- 012_bootstrap_ibraziz_super_admin.sql
-- Bootstrap/promote ibraziz21@gmail.com as a super admin for the admin dashboard.
-- Run after 001_admin_users.sql.
--
-- The password_hash below uses the admin-dashboard PBKDF2-SHA256 format:
--   saltHex:hashHex
-- Rotate the temporary password immediately after first login.

insert into admin_users (
  email,
  password_hash,
  name,
  role,
  is_active
) values (
  'ibraziz21@gmail.com',
  '961a84e0c5fbc23856852c9913398bd3:71516d7aaa77c6477e6805d2dc6831310ad5d357183a1caebd25b54543e57a27',
  'Ibrahim Aziz',
  'super_admin'::admin_role,
  true
)
on conflict (email) do update
set
  password_hash = excluded.password_hash,
  name = excluded.name,
  role = 'super_admin'::admin_role,
  is_active = true,
  updated_at = now();

delete from admin_login_attempts
where email = 'ibraziz21@gmail.com';

select
  id,
  email,
  name,
  role,
  is_active,
  created_at,
  updated_at
from admin_users
where email = 'ibraziz21@gmail.com';
