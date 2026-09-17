-- Adds phone and city to hub_user_profiles as first-class identity
-- attributes on the consumer profile ("My Akiba" redesign). Phone
-- verification (SMS/OTP) is intentionally not built yet — no vendor is
-- wired up anywhere in this codebase — so `phone_verified` always writes
-- `false` for now; the column exists so the UI's "Unverified" state and a
-- future verification flow don't require another migration.

ALTER TABLE hub_user_profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS city text;
