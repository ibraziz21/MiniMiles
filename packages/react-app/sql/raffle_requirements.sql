-- Raffle gate configuration used by the app/backend before joinRaffle writes.
-- Gates are app-level only; the smart contract remains unaware of these rules.

create extension if not exists pgcrypto;

create or replace function public.validate_raffle_requirement_gates(p_gates jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  gate jsonb;
  gate_type text;
  min_usd numeric;
begin
  if p_gates is null or jsonb_typeof(p_gates) <> 'array' then
    return false;
  end if;

  for gate in select value from jsonb_array_elements(p_gates)
  loop
    if jsonb_typeof(gate) <> 'object' then
      return false;
    end if;

    gate_type := gate->>'type';

    if gate_type = 'min_usdt_balance' then
      if not gate ? 'minUsd' then
        return false;
      end if;

      begin
        min_usd := (gate->>'minUsd')::numeric;
      exception when others then
        return false;
      end;

      if min_usd <= 0 then
        return false;
      end if;
    elsif gate_type in ('prosperity_pass_holder', 'daily_5tx_completed') then
      -- no extra config required
      null;
    else
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create table if not exists public.raffle_requirements (
  id uuid primary key default gen_random_uuid(),
  round_id bigint not null unique check (round_id > 0),
  mode text not null default 'all' check (mode in ('all', 'any')),
  gates jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffle_requirements_gates_array check (jsonb_typeof(gates) = 'array'),
  constraint raffle_requirements_gates_valid check (public.validate_raffle_requirement_gates(gates))
);

create index if not exists raffle_requirements_enabled_round_idx
  on public.raffle_requirements (round_id)
  where enabled = true;

create or replace function public.touch_raffle_requirements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists raffle_requirements_touch_updated_at on public.raffle_requirements;
create trigger raffle_requirements_touch_updated_at
before update on public.raffle_requirements
for each row
execute function public.touch_raffle_requirements_updated_at();

alter table public.raffle_requirements enable row level security;

-- Service-role clients bypass RLS. Add dashboard-specific policies in the
-- dashboard repo if it uses end-user Supabase auth instead of the service key.
