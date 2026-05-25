create table if not exists public.partner_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null,
  country text not null,
  role text,
  website text,
  message text not null,
  source text not null default 'website',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists partner_leads_created_at_idx
  on public.partner_leads (created_at desc);

create index if not exists partner_leads_status_idx
  on public.partner_leads (status);

alter table public.partner_leads enable row level security;

-- Public inserts are intentionally not enabled. The website API writes with a
-- Supabase service role key after validating the request and Turnstile token.
