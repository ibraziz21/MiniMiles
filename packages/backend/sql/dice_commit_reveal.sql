-- Commit-reveal persistence for AkibaDice.
--
-- Secrets are stored server-side only. The contract stores just the commit:
--   keccak256(abi.encodePacked(secret, diceAddress, chainId, nonce))

create table if not exists public.dice_house_commits (
  nonce numeric(78, 0) primary key,
  chain_id numeric(78, 0) not null,
  dice_address text not null,
  commit text not null unique,
  secret text not null,
  status text not null default 'prepared'
    check (status in ('prepared', 'queued', 'assigned', 'revealed', 'expired', 'failed')),
  round_id numeric(78, 0),
  queue_tx_hash text,
  reveal_tx_hash text,
  last_error text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  assigned_at timestamptz,
  revealed_at timestamptz,
  expired_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint dice_house_commits_commit_hex
    check (commit ~ '^0x[0-9a-fA-F]{64}$'),
  constraint dice_house_commits_secret_hex
    check (secret ~ '^0x[0-9a-fA-F]{64}$'),
  constraint dice_house_commits_dice_address_hex
    check (dice_address ~ '^0x[0-9a-fA-F]{40}$')
);

create index if not exists dice_house_commits_status_idx
  on public.dice_house_commits (status, nonce);

create index if not exists dice_house_commits_round_idx
  on public.dice_house_commits (round_id);

create or replace function public.touch_dice_house_commits_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dice_house_commits_touch_updated_at
  on public.dice_house_commits;
create trigger dice_house_commits_touch_updated_at
before update on public.dice_house_commits
for each row
execute function public.touch_dice_house_commits_updated_at();
