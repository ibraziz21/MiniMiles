-- Server-recorded proof for merchant-discovery actions that cannot be inferred
-- from an existing domain table. Reads and writes stay behind authenticated
-- API routes; no anon/authenticated RLS policy is intentionally created.

create table if not exists merchant_quest_action_proofs (
  user_address text not null,
  partner_quest_id uuid not null references partner_quests(id),
  action_type text not null check (
    action_type in ('pass_onboarding_opened', 'deal_opened')
  ),
  action_ref text not null,
  recorded_at timestamptz not null default now(),
  primary key (user_address, partner_quest_id, action_type, action_ref)
);

create index if not exists merchant_quest_action_proofs_lookup_idx
  on merchant_quest_action_proofs (
    user_address,
    partner_quest_id,
    action_type,
    recorded_at desc
  );

alter table merchant_quest_action_proofs enable row level security;
