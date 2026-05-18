-- External EOA links for Prosperity Pass.
-- Written and verified by the react-app API; useful for admin visibility.

create extension if not exists pgcrypto;

create table if not exists public.prosperity_pass_linked_wallets (
  id uuid primary key default gen_random_uuid(),
  primary_wallet text not null check (primary_wallet ~ '^0x[a-f0-9]{40}$'),
  safe_address text not null check (safe_address ~ '^0x[a-f0-9]{40}$'),
  linked_wallet text not null check (linked_wallet ~ '^0x[a-f0-9]{40}$'),
  status text not null default 'created' check (
    status in (
      'created',
      'signature_verified',
      'safe_approved',
      'linked',
      'failed',
      'expired'
    )
  ),
  signature_message text,
  signature text check (signature is null or signature ~ '^0x[a-fA-F0-9]+$'),
  signature_verified_at timestamptz,
  safe_approval_tx_hash text check (
    safe_approval_tx_hash is null or safe_approval_tx_hash ~ '^0x[a-fA-F0-9]{64}$'
  ),
  safe_approved_at timestamptz,
  final_tx_hash text check (
    final_tx_hash is null or final_tx_hash ~ '^0x[a-fA-F0-9]{64}$'
  ),
  linked_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prosperity_pass_linked_wallets_distinct_wallets
    check (primary_wallet <> linked_wallet)
);

create unique index if not exists prosperity_pass_linked_wallets_one_active_primary_idx
  on public.prosperity_pass_linked_wallets (primary_wallet)
  where status in ('created', 'signature_verified', 'safe_approved', 'linked');

create unique index if not exists prosperity_pass_linked_wallets_one_active_external_idx
  on public.prosperity_pass_linked_wallets (linked_wallet)
  where status in ('created', 'signature_verified', 'safe_approved', 'linked');

create index if not exists prosperity_pass_linked_wallets_status_expiry_idx
  on public.prosperity_pass_linked_wallets (status, expires_at);

create or replace function public.touch_prosperity_pass_linked_wallets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prosperity_pass_linked_wallets_touch_updated_at
  on public.prosperity_pass_linked_wallets;
create trigger prosperity_pass_linked_wallets_touch_updated_at
before update on public.prosperity_pass_linked_wallets
for each row
execute function public.touch_prosperity_pass_linked_wallets_updated_at();

alter table public.prosperity_pass_linked_wallets enable row level security;

-- Service-role clients bypass RLS. Add dashboard-specific policies only if
-- end-user Supabase auth reads/writes are introduced later.
