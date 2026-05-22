-- ── Phase 2: Partner settings, product/voucher management, team roles ─────────

-- ── Add role + is_active to merchant_users if not present ─────────────────────
ALTER TABLE merchant_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff'
    CHECK (role IN ('owner', 'manager', 'staff')),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ── partner_settings ─────────────────────────────────────────────────────────
-- Stores per-partner operational settings.
CREATE TABLE IF NOT EXISTS partner_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL UNIQUE REFERENCES partners(id) ON DELETE CASCADE,
  store_active          boolean NOT NULL DEFAULT true,
  logo_url              text,
  support_email         text,
  support_phone         text,
  delivery_cities       text[] NOT NULL DEFAULT ARRAY['Nairobi','Mombasa'],
  notify_new_order      boolean NOT NULL DEFAULT true,
  notify_stale_order    boolean NOT NULL DEFAULT true,
  stale_threshold_hours integer NOT NULL DEFAULT 2,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_partner_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_partner_settings_updated_at ON partner_settings;
CREATE TRIGGER trg_partner_settings_updated_at
  BEFORE UPDATE ON partner_settings
  FOR EACH ROW EXECUTE FUNCTION update_partner_settings_updated_at();

-- ── notification_log ──────────────────────────────────────────────────────────
-- Records every notification (email/in-app) sent to merchant users.
CREATE TABLE IF NOT EXISTS merchant_notification_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      uuid NOT NULL,
  merchant_user_id uuid,                   -- null = sent to all partner users
  type            text NOT NULL,           -- 'new_order' | 'stale_order' | 'out_for_delivery_followup'
  order_id        uuid,
  subject         text,
  body_preview    text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_partner_sent ON merchant_notification_log(partner_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_order ON merchant_notification_log(order_id) WHERE order_id IS NOT NULL;

-- Immutable: never update or delete notification log rows
CREATE OR REPLACE RULE no_update_notif_log AS ON UPDATE TO merchant_notification_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_notif_log AS ON DELETE TO merchant_notification_log DO INSTEAD NOTHING;
