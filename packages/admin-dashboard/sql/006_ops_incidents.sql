-- Ops incident tracker for manual intervention queue.

create type incident_status as enum ('open', 'in_progress', 'resolved', 'wont_fix');
create type incident_type as enum (
  'stale_order',
  'failed_randomness',
  'unresolved_payout',
  'suspicious_redemption',
  'manual_review',
  'other'
);

create table if not exists ops_incidents (
  id              uuid primary key default gen_random_uuid(),
  incident_type   incident_type not null,
  status          incident_status not null default 'open',
  title           text not null,
  description     text,
  target_type     text,           -- 'order', 'wallet', 'merchant', 'round', etc.
  target_id       text,
  assigned_to     uuid references admin_users(id) on delete set null,
  created_by      uuid references admin_users(id) on delete set null,
  resolved_by     uuid references admin_users(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ops_incidents_status_idx on ops_incidents (status) where status != 'resolved';
create index if not exists ops_incidents_type_idx   on ops_incidents (incident_type);
create index if not exists ops_incidents_created_at on ops_incidents (created_at desc);

create trigger ops_incidents_updated_at
  before update on ops_incidents
  for each row execute function set_updated_at();
