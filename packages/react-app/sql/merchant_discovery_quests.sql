-- Merchant discovery quests (Earn tab) — spend-earn-redesign-spec.md §2b/§3.
--
-- Reuses the existing partner_quests / partner_engagements / claim+eligibility
-- API exactly as the retired partner-quests.tsx catalog did. The one addition
-- is `partner_quest_weekly_claims`, a week-scoped sibling of partner_engagements
-- for the single repeatable quest ("Play the sponsored leaderboard") — the
-- existing partner_engagements table is a once-ever uniqueness on
-- (user_address, partner_quest_id) and can't express a weekly reset.

create table if not exists partner_quest_weekly_claims (
  user_address text not null,
  partner_quest_id uuid not null references partner_quests(id),
  iso_week text not null, -- e.g. '2026-W30', see lib/games/week.ts
  claimed_at timestamptz not null default now(),
  primary key (user_address, partner_quest_id, iso_week)
);

alter table partner_quest_weekly_claims enable row level security;

-- Public read (mirrors partner_engagements / daily_engagements / streaks —
-- completion flags are not sensitive, writes stay service-role only).
create policy "partner_quest_weekly_claims_public_read"
  on partner_quest_weekly_claims for select
  using (true);

-- ── Launch quest catalog seed ────────────────────────────────────────────────
-- Fixed IDs referenced by components/merchant-discovery-quests.tsx — keep in
-- sync if you change one here.

insert into partner_quests (id, title, description, reward_points, action_link) values
  ('f647e695-7009-455a-a138-b3ee50de73f2', 'Get your Akiba Pass',
   'Your personal QR code — earn Miles in real shops.', 20, '/akiba-pass?src=earn_quest'),
  ('4eaf67c7-03f5-4c24-a63d-2c1c8ab765d1', 'Browse this week''s merchant deals',
   'See what you can spend your Miles on right now.', 5, '/spend'),
  ('c94ded62-19e8-4d04-910b-56e0dd1bec34', 'Play the sponsored leaderboard',
   'Play this week''s featured game — resets every week.', 25, '/games/challenge'),
  ('47bc3625-f2f6-4b0f-ae72-b8bfde85bd31', 'Complete your profile',
   'Set your country so we can route local deals and prizes to you.', 50, '/profile'),
  ('2ad4bc13-d3b9-41b6-b3ef-d3a1ebb7b2aa', 'Redeem your first voucher',
   'Use a voucher at checkout to complete this quest.', 100, '/vouchers')
on conflict (id) do nothing;
