-- Verified insights workflow: raw poll → review → verified summary.

create table if not exists verified_insights (
  id              uuid primary key default gen_random_uuid(),
  poll_id         uuid not null references polls(id) on delete cascade,
  summary         text not null,          -- final verified summary prose
  key_findings    jsonb,                  -- array of finding strings
  reviewed_by     uuid references admin_users(id) on delete set null,
  verified_by     uuid references admin_users(id) on delete set null,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger verified_insights_updated_at
  before update on verified_insights
  for each row execute function set_updated_at();

-- Admin review notes attached to a poll during the verification workflow.
create table if not exists insight_review_notes (
  id            uuid primary key default gen_random_uuid(),
  poll_id       uuid not null references polls(id) on delete cascade,
  admin_user_id uuid references admin_users(id) on delete set null,
  note          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists insight_review_notes_poll_idx on insight_review_notes (poll_id, created_at desc);
