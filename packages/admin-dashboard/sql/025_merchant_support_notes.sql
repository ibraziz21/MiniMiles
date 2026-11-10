BEGIN;
CREATE TABLE IF NOT EXISTS merchant_admin_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 partner_id text NOT NULL,
 admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
 note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_admin_notes_partner_idx ON merchant_admin_notes(partner_id,created_at DESC);
ALTER TABLE merchant_admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_admin_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON merchant_admin_notes TO service_role;
COMMIT;
