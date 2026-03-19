create table if not exists public.passport_ops (
  operation_id text primary key,
  address      text not null,
  amount       integer not null check (amount > 0),
  type         text not null check (type in ('burn', 'refund')),
  status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'completed', 'failed')),
  tx_hash      text,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists passport_ops_address_idx
  on public.passport_ops (address, type);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'passport_ops_touch_updated_at'
  ) then
    create trigger passport_ops_touch_updated_at
    before update on public.passport_ops
    for each row
    execute function public.touch_minipoint_updated_at();
  end if;
end
$$;
