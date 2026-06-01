begin;

create table if not exists public.merchant_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null,
  country text not null,
  role text,
  website text,
  message text not null,
  source text not null default 'website_merchants_page',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists merchant_leads_created_at_idx
  on public.merchant_leads (created_at desc);

create index if not exists merchant_leads_status_idx
  on public.merchant_leads (status);

alter table public.merchant_leads enable row level security;

insert into public.merchant_leads (
  id,
  name,
  email,
  company,
  country,
  role,
  website,
  message,
  source,
  status,
  user_agent,
  ip_hash,
  created_at
)
select
  id,
  name,
  email,
  company,
  country,
  role,
  website,
  message,
  source,
  status,
  user_agent,
  ip_hash,
  created_at
from public.partner_leads
where source = 'website_merchants_page'
on conflict (id) do nothing;

delete from public.partner_leads
where source = 'website_merchants_page'
  and id in (select id from public.merchant_leads);

commit;
