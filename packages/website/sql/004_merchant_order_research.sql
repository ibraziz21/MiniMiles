create table if not exists public.merchant_order_research_responses (
  id uuid primary key,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.merchant_order_research_responses enable row level security;
revoke all on table public.merchant_order_research_responses from public, anon, authenticated;
grant select, insert on table public.merchant_order_research_responses to service_role;
