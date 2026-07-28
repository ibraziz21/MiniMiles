-- 030_hub_onboarding_fields.sql
-- hub-page home-redesign-spec.md §5/§6: tracks whether a Hub user has seen
-- the /welcome onboarding carousel (shown once, skippable, never re-shown
-- after skip), and which acquisition source (poster/location) a signup came
-- from via /join?src=... — both live on hub_user_passes since that's the row
-- created exactly once per new Hub user (see src/lib/akiba/pass.ts).

alter table hub_user_passes
  add column if not exists onboarding_seen_at timestamptz,
  add column if not exists signup_src text;
