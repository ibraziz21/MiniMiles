-- 008_hub_user_passes.sql
-- Stable public pass identifier per Hub user.
--
-- The public_pass_id is a stable UUID encoded in the Akiba Pass QR card.
-- Merchants scan it and call GET /api/me/pass/resolve?passId=<uuid> to identify
-- the customer.  The ID never grants account access on its own.
--
-- Replaces the previous 24-hour HMAC-token approach, enabling saved pass images
-- to remain valid until the user explicitly regenerates their QR.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_user_passes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,        -- denormalised for fast resolver lookups
  public_pass_id  UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at  TIMESTAMPTZ,                 -- set each time the user requests a new QR

  UNIQUE (user_id),          -- one pass per Hub user
  UNIQUE (public_pass_id)    -- prevents brute-force enumeration
);

COMMENT ON TABLE hub_user_passes IS
  'One stable public pass identifier per Hub user. '
  'The public_pass_id is safe to embed in QR codes — it carries no credentials '
  'and is only resolved to a customer identity by authenticated merchant callers.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE hub_user_passes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own pass (for the /me profile page).
CREATE POLICY "hub_passes_select_own"
  ON hub_user_passes FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (used by API routes via createAdminClient) bypasses RLS.
-- No explicit service_role policies are needed.

-- ── Index ─────────────────────────────────────────────────────────────────────
-- The resolve endpoint looks up by public_pass_id; the UNIQUE constraint above
-- already creates this index, so no additional CREATE INDEX is needed.
