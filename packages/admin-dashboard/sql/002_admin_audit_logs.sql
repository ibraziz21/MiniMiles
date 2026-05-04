-- Immutable audit log for all sensitive admin actions.
-- Never update or delete rows — only insert.

create table if not exists admin_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid references admin_users(id) on delete set null,
  action        text not null,           -- e.g. "merchant.deactivated", "wallet.blacklisted"
  target_type   text,                    -- e.g. "merchant", "wallet", "order"
  target_id     text,                    -- the affected entity's id
  metadata      jsonb,                   -- arbitrary additional context
  ip_address    text,
  created_at    timestamptz not null default now()
);

create index if not exists admin_audit_logs_admin_user_idx on admin_audit_logs (admin_user_id);
create index if not exists admin_audit_logs_action_idx     on admin_audit_logs (action);
create index if not exists admin_audit_logs_target_idx     on admin_audit_logs (target_type, target_id);
create index if not exists admin_audit_logs_created_at_idx on admin_audit_logs (created_at desc);
