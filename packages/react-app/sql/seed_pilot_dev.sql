-- seed_pilot_dev.sql
-- Dev/staging seed: lights up every campaign-driven surface built on this
-- branch (sponsored hub header, weekly banner, announcement, deals shelf,
-- win sheet / My Prizes via a test prize).
--
-- PREREQUISITE: run sql/leaderboard_voucher_prizes.sql first.
-- Idempotent-ish: uses fixed UUIDs so re-runs upsert instead of duplicating.
--
-- ⚠ Replace :TEST_WALLET below before running step 4.

-- ── 1. Pilot merchant ─────────────────────────────────────────────────────────
insert into partners (id, slug, name, country, image_url)
values (
  'aaaaaaaa-0000-4000-8000-000000000001',
  'leshan-electronics',
  'Leshan Electronics',
  'Kenya',
  null
)
on conflict (id) do update set name = excluded.name, country = excluded.country;

-- ── 2. Voucher templates (prize tiers + they double as marketplace deals) ─────
-- Adjust column list if your spend_voucher_templates has NOT NULL columns not
-- covered here (miles_cost = marketplace price for the deals shelf).
insert into spend_voucher_templates
  (id, merchant_id, title, voucher_type, discount_percent, miles_cost, active)
values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   '25% off at Leshan (up to KES 3,000 spend)', 'percent_off', 25, 750, true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
   '15% off at Leshan (up to KES 3,000 spend)', 'percent_off', 15, 500, true),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
   '10% off at Leshan (up to KES 3,000 spend)', 'percent_off', 10, 300, true)
on conflict (id) do update set title = excluded.title, active = true;

-- ── 3. Active campaign covering the current ISO week ─────────────────────────
insert into game_weekly_campaigns (id, merchant_id, week_from, week_to, active, game_types, tiers)
values (
  'cccccccc-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  date_trunc('week', now())::date,                    -- this Monday
  (date_trunc('week', now()) + interval '28 days')::date,  -- 4 weeks (dev convenience)
  true,
  '{rule_tap,memory_flip}',
  '[
    {"rank":1,"template_id":"bbbbbbbb-0000-4000-8000-000000000001","label":"25% off","discount_percent":25,"spend_cap_kes":3000,"marketplace_miles":750,"burn_pct":0.80,"expiry_burn_pct":0.50},
    {"rank":2,"template_id":"bbbbbbbb-0000-4000-8000-000000000002","label":"15% off","discount_percent":15,"spend_cap_kes":3000,"marketplace_miles":500,"burn_pct":0.80,"expiry_burn_pct":0.50},
    {"rank":3,"template_id":"bbbbbbbb-0000-4000-8000-000000000003","label":"10% off","discount_percent":10,"spend_cap_kes":3000,"marketplace_miles":300,"burn_pct":0.80,"expiry_burn_pct":0.50}
  ]'::jsonb
)
on conflict (id) do update
  set active = true,
      week_from = excluded.week_from,
      week_to = excluded.week_to,
      tiers = excluded.tiers;

-- ── 4. Test prize → lights up My Prizes strip + win reveal sheet ─────────────
-- Replace :TEST_WALLET with your dev wallet (lowercase 0x…), then run:
--
-- select * from issue_leaderboard_prize(
--   'cccccccc-0000-4000-8000-000000000001',
--   'memory_flip',
--   'DEV-TEST',          -- fake week label so it never collides with real settlement
--   2,
--   :TEST_WALLET,
--   999,
--   'DEVTEST2345',
--   '{"code":"DEVTEST2345","dev":true}'
-- );
--
-- Cleanup: delete from issued_vouchers where source_ref like 'memory_flip:DEV-TEST%';

-- ── 5. Verify ────────────────────────────────────────────────────────────────
-- select * from game_weekly_campaigns where active;
-- GET /api/games/weekly-campaign should now return the campaign.
