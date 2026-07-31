-- Verified wallet linking (production-readiness-security-spec.md §3, PR-01).
-- Wallets can currently be linked with a bare address and no ownership
-- proof. This adds a challenge/verify flow: a short-lived, single-use,
-- domain- and user-bound challenge that must be signed by the wallet before
-- a link is treated as authoritative for any asset/reward operation.

-- ── 1. Extend hub_user_wallets with verification state ─────────────────────
ALTER TABLE hub_user_wallets
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'legacy_unverified'
    CHECK (verification_status IN ('legacy_unverified', 'verified', 'revoked')),
  ADD COLUMN IF NOT EXISTS verification_method text
    CHECK (verification_method IN ('eip191', 'eip712', 'trusted_handoff', 'admin')),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_huw_verification_status ON hub_user_wallets (verification_status);

-- Every row that predates this migration is unproven — mark it explicitly so
-- ownership logic can exclude it without guessing from other columns
-- (§3.4 "never infer verification from matching email alone").
UPDATE hub_user_wallets
SET verification_status = 'legacy_unverified'
WHERE verification_status IS NULL OR verification_method IS NULL;

-- Client-side writes (even with a valid session + anon key) must never be
-- able to set verification_status='verified' directly — all writes to this
-- table now go through the service-role app layer or the RPC below. Users
-- may still read and unlink their own rows.
DROP POLICY IF EXISTS hub_wallets_insert_own ON hub_user_wallets;
DROP POLICY IF EXISTS hub_wallets_update_own ON hub_user_wallets;

-- ── 2. Wallet-link challenges ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_link_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecosystem       text NOT NULL CHECK (ecosystem IN ('minipay', 'base')),
  address         text NOT NULL, -- normalized lowercase 0x… address being challenged
  -- Plaintext nonce, needed to deterministically rebuild the exact signed
  -- message at verify time (the message itself is never persisted, and the
  -- verify endpoint only receives challengeId + signature per §3.2, not the
  -- message text). Not a secret: it's embedded in the message shown to and
  -- signed by the wallet, so there is no confidentiality loss in storing it
  -- in the clear. nonce_hash exists alongside it purely to give the
  -- uniqueness constraint a fixed-width, collision-resistant key.
  nonce           text NOT NULL,
  nonce_hash      text NOT NULL UNIQUE,
  statement_hash  text NOT NULL,
  chain_id        bigint NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Only one live (unconsumed, unexpired) challenge per user/ecosystem/address
-- at a time (§3.1). Partial unique index rather than a table constraint
-- since "live" is a function of consumed_at/expires_at, not a stored column.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_link_challenges_live
  ON wallet_link_challenges (hub_user_id, ecosystem, address)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_link_challenges_expires_at
  ON wallet_link_challenges (expires_at);

ALTER TABLE wallet_link_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_link_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_link_challenges TO service_role;

-- ── 3. Identity-merge incidents (§3.3) ──────────────────────────────────────
-- Recorded, never auto-resolved, when a wallet link would otherwise need to
-- overwrite an existing legacy users row's email.
CREATE TABLE IF NOT EXISTS identity_merge_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address    text NOT NULL,
  legacy_email      text,
  hub_email         text,
  reason            text NOT NULL,
  resolved_at       timestamptz,
  resolved_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE identity_merge_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON identity_merge_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON identity_merge_incidents TO service_role;

-- ── 4. Atomic verify-and-link RPC ───────────────────────────────────────────
-- Consumes the challenge and upserts the verified wallet link in one
-- transaction. The caller (API route) has already recovered and compared
-- the signer address off-chain with viem; this RPC re-checks challenge
-- validity server-side so a race can't reuse it twice.
CREATE OR REPLACE FUNCTION link_verified_wallet(
  p_challenge_id uuid,
  p_hub_user_id  uuid,
  p_method       text
)
RETURNS TABLE(ok boolean, error_code text, address text, ecosystem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge wallet_link_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_challenge
  FROM wallet_link_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'challenge_not_found', NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_challenge.hub_user_id <> p_hub_user_id THEN
    RETURN QUERY SELECT false, 'wrong_user', NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_challenge.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_consumed', NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_challenge.expires_at < now() THEN
    RETURN QUERY SELECT false, 'expired', NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE wallet_link_challenges SET consumed_at = now() WHERE id = p_challenge_id;

  INSERT INTO hub_user_wallets (
    user_id, ecosystem, address, verification_status, verification_method, verified_at
  )
  VALUES (
    p_hub_user_id, v_challenge.ecosystem, v_challenge.address, 'verified', p_method, now()
  )
  ON CONFLICT (user_id, ecosystem) DO UPDATE SET
    address              = EXCLUDED.address,
    verification_status  = 'verified',
    verification_method  = p_method,
    verified_at          = now(),
    revoked_at            = NULL;

  RETURN QUERY SELECT true, NULL::text, v_challenge.address, v_challenge.ecosystem;
END
$$;

REVOKE ALL ON FUNCTION link_verified_wallet(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_verified_wallet(uuid, uuid, text) TO service_role;

-- Note: the legacy `users` table bridge (§3.3 — insert-if-absent, never
-- overwrite an existing row's email, record an identity_merge_incidents row
-- on conflict) is implemented in application code
-- (src/lib/akiba/legacyUsersBridge.ts), not as a SQL RPC here: `users` is
-- owned by another package's schema and isn't created by any migration in
-- this repo, so a function referencing it here would fail CI's
-- "migration apply on an empty database" gate. identity_merge_incidents
-- above is still the durable record of any conflict that bridge finds.
