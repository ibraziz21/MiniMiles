-- Admin-managed metadata for raffle rounds.
-- Supplements on-chain data (winners count, display title, description, image).
-- Written by akiba-dash/akiba-admin via POST /api/admin/raffles/meta.
-- Read by the react-app raffle_display route to enrich raffle cards.
--
-- Column names must match the akiba-dash upsert payload exactly:
--   round_id, kind, card_title, description, card_image_url, prize_title, winners

create table if not exists public.raffle_meta (
  id uuid primary key default gen_random_uuid(),
  round_id bigint not null unique check (round_id > 0),
  kind text check (kind in ('token', 'physical')),
  card_title text,
  prize_title text,
  description text,
  card_image_url text,
  winners integer not null default 1 check (winners >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists raffle_meta_round_idx on public.raffle_meta (round_id);

create or replace function public.touch_raffle_meta_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists raffle_meta_touch_updated_at on public.raffle_meta;
create trigger raffle_meta_touch_updated_at
before update on public.raffle_meta
for each row
execute function public.touch_raffle_meta_updated_at();

alter table public.raffle_meta enable row level security;

-- Service-role clients (used by akiba-dash admin and the react-app backend)
-- bypass RLS automatically. Add row-level policies here only if anon/user-role
-- reads are needed in future.
