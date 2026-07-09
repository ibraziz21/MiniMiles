-- 019_farkle_reactions.sql
-- Tap-to-send emote reactions for PvP Farkle
-- (v1: fire, cry, laugh, tongue, angry_censored).
-- Stored per-match reactions, cosmetic only — no impact on match state, scoring, or settlement.
-- Reactions are retained for the life of the match (deleted via cascade when game_matches row is
-- removed). Rate limiting and participant checks are enforced by the farkle_send_reaction RPC
-- added in migration 021.

create table if not exists public.farkle_reactions (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.game_matches(id) on delete cascade,
  wallet_address  text not null,
  emoji           text not null
                    check (emoji in ('fire', 'cry', 'laugh', 'tongue', 'angry_censored')),
  created_at      timestamptz not null default now()
);

create index if not exists farkle_reactions_match_created_idx
  on public.farkle_reactions (match_id, created_at desc);

create index if not exists farkle_reactions_match_wallet_created_idx
  on public.farkle_reactions (match_id, wallet_address, created_at desc);

alter table public.farkle_reactions enable row level security;

drop policy if exists service_role_all on public.farkle_reactions;
create policy service_role_all on public.farkle_reactions
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
