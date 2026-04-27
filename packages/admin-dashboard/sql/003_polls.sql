-- Poll infrastructure for AkibaMiles Insights.

create type poll_status as enum ('draft', 'live', 'closed', 'verified');
create type question_type as enum ('single_choice', 'multi_choice', 'rating', 'free_text');

create table if not exists polls (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  status          poll_status not null default 'draft',
  target_segment  jsonb,        -- e.g. { "cities": ["Nairobi"], "min_wallet_age_days": 30 }
  starts_at       timestamptz,
  ends_at         timestamptz,
  created_by      uuid references admin_users(id) on delete set null,
  closed_by       uuid references admin_users(id) on delete set null,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger polls_updated_at
  before update on polls
  for each row execute function set_updated_at();

create table if not exists poll_questions (
  id            uuid primary key default gen_random_uuid(),
  poll_id       uuid not null references polls(id) on delete cascade,
  question_text text not null,
  question_type question_type not null,
  options       jsonb,          -- array of strings for choice questions
  sort_order    int not null default 0,
  required      boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists poll_questions_poll_idx on poll_questions (poll_id, sort_order);

-- One response row per user per poll.
create table if not exists poll_responses (
  id              uuid primary key default gen_random_uuid(),
  poll_id         uuid not null references polls(id) on delete cascade,
  user_address    text not null,
  wallet_age_days int,
  city            text,
  merchant_id     text,         -- last interacted merchant at time of response
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  is_complete     boolean not null default false,
  quality_flag    text,         -- 'spam', 'low_quality', null
  unique (poll_id, user_address)
);

create index if not exists poll_responses_poll_idx  on poll_responses (poll_id);
create index if not exists poll_responses_user_idx  on poll_responses (user_address);

-- One answer row per question per response.
create table if not exists poll_response_answers (
  id             uuid primary key default gen_random_uuid(),
  response_id    uuid not null references poll_responses(id) on delete cascade,
  question_id    uuid not null references poll_questions(id) on delete cascade,
  selected_options jsonb,       -- array of choice strings
  rating_value   int,
  free_text      text,
  created_at     timestamptz not null default now()
);

create index if not exists poll_response_answers_response_idx on poll_response_answers (response_id);
create index if not exists poll_response_answers_question_idx on poll_response_answers (question_id);
