create table if not exists hub_waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text not null default 'hub_page',
  ip_hash     text,
  user_agent  text,
  created_at  timestamptz not null default now(),

  constraint hub_waitlist_email_unique unique (email)
);

-- Only the service role can read/write; anon gets nothing
alter table hub_waitlist enable row level security;

comment on table hub_waitlist is 'Emails collected from the Akiba Hub waitlist form on the website.';
