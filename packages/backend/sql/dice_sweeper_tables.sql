create table if not exists public.dice_unresolved_rounds (
  round_id bigint primary key,
  tier numeric not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_retry_at timestamptz,
  retry_count integer not null default 0,
  random_block numeric not null default 0,
  filled_slots integer not null default 0,
  round_state text not null,
  active boolean not null default true,
  source text not null default 'advanced-before-resolved',
  last_error text,
  last_action text
);

alter table public.dice_unresolved_rounds
  add column if not exists last_retry_at timestamptz;

alter table public.dice_unresolved_rounds
  add column if not exists retry_count integer not null default 0;

alter table public.dice_unresolved_rounds
  add column if not exists random_block numeric not null default 0;

alter table public.dice_unresolved_rounds
  add column if not exists filled_slots integer not null default 0;

alter table public.dice_unresolved_rounds
  add column if not exists round_state text;

alter table public.dice_unresolved_rounds
  add column if not exists active boolean not null default true;

alter table public.dice_unresolved_rounds
  add column if not exists source text not null default 'advanced-before-resolved';

alter table public.dice_unresolved_rounds
  add column if not exists last_error text;

alter table public.dice_unresolved_rounds
  add column if not exists last_action text;

update public.dice_unresolved_rounds
set round_state = coalesce(round_state, 'Unknown')
where round_state is null;

alter table public.dice_unresolved_rounds
  alter column round_state set not null;

create index if not exists dice_unresolved_rounds_active_idx
  on public.dice_unresolved_rounds (active, last_seen_at desc);

create index if not exists dice_unresolved_rounds_tier_idx
  on public.dice_unresolved_rounds (tier, active);

create table if not exists public.dice_tier_watch_state (
  tier numeric primary key,
  active_round_id bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.dice_tier_watch_state
  add column if not exists updated_at timestamptz not null default now();
