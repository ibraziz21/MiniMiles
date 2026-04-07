-- ── merchant_users ────────────────────────────────────────────────────────────
-- Each row represents one login credential for a merchant operator.
-- A partner (merchant) can have multiple users (e.g. manager + fulfillment staff).
-- partner_id references the existing `partners` table in the MiniMiles DB.

CREATE TABLE IF NOT EXISTS merchant_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,            -- PBKDF2-SHA256, format: <salt_hex>:<hash_hex>
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name            text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_users_partner ON merchant_users(partner_id);
CREATE INDEX IF NOT EXISTS idx_merchant_users_email   ON merchant_users(email);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_merchant_users_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_users_updated_at ON merchant_users;
CREATE TRIGGER trg_merchant_users_updated_at
  BEFORE UPDATE ON merchant_users
  FOR EACH ROW EXECUTE FUNCTION update_merchant_users_updated_at();


-- ── merchant_audit_log ────────────────────────────────────────────────────────
-- Immutable record of every action taken by a merchant user.
-- Rows are never updated or deleted.

CREATE TABLE IF NOT EXISTS merchant_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_user_id  uuid NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
  partner_id        uuid NOT NULL,           -- denormalised for fast per-partner queries
  action            text NOT NULL,           -- e.g. "order.accepted", "order.cancelled"
  order_id          uuid,                    -- nullable: some actions are not order-specific
  metadata          jsonb,                   -- arbitrary key-value context
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_partner_created   ON merchant_audit_log(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_order_id          ON merchant_audit_log(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_merchant_user     ON merchant_audit_log(merchant_user_id);

-- Prevent any UPDATE or DELETE on the audit log (rows are append-only)
CREATE OR REPLACE RULE no_update_audit AS ON UPDATE TO merchant_audit_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_audit AS ON DELETE TO merchant_audit_log DO INSTEAD NOTHING;
