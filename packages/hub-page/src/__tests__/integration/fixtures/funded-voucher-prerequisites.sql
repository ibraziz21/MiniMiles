-- Prerequisite schema for the Akiba-funded voucher claim path.
--
-- The funded-voucher tables themselves are NOT created here: the test applies
-- the real Akiba-Platform migrations (086, 115, 117, 123, 124) on top of this,
-- so the constraints under test are the live ones. This file only stubs what
-- those migrations assume already exists — the Supabase roles, auth.users, and
-- the Platform core/identity tables whose own migrations reach back to 013 and
-- are not worth replaying for a claim-path test.
--
-- Same approach as migration.test.ts's SETUP_SQL: minimal shapes that mirror
-- the live columns the code under test actually reads.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Platform core (013_audit_logs_v2.sql; 115 widens actor_type to include 'member')
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,
  actor_type  text NOT NULL CHECK (actor_type IN ('internal_user','partner_user','api_key','system')),
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  before      jsonb,
  after       jsonb,
  ip_address  text,
  user_agent  text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partners (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        text,
  name                        text NOT NULL DEFAULT 'Test Merchant',
  image_url                   text,
  status                      text NOT NULL DEFAULT 'active',
  country                     text,
  type                        text NOT NULL DEFAULT 'merchant',
  tier                        text,
  payout_destination_approved boolean NOT NULL DEFAULT false
);

-- Identity and member state read by claim_akiba_funded_voucher_atomic
CREATE TABLE IF NOT EXISTS hub_user_canonicals (
  hub_user_id  uuid PRIMARY KEY,
  canonical_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_user_profiles (
  user_id      uuid PRIMARY KEY,
  country_code text
);

CREATE TABLE IF NOT EXISTS hub_user_passes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboard_profiles (
  canonical_id uuid PRIMARY KEY,
  username     text NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_type  text NOT NULL,
  identity_value text NOT NULL,
  canonical_id   uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Read by the no_prior_merchant_redemption rule
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_voucher_id uuid,
  hub_user_id       uuid,
  user_address      text,
  merchant_id       uuid,
  discount_applied  numeric,
  redeemed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Read by the verified_activity_completed rule
CREATE TABLE IF NOT EXISTS verification_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  status       text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS verifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  user_id      uuid,
  status       text NOT NULL,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
