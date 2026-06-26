-- Hub user wallet links
-- Ties a Supabase auth user (email/OTP login) to their on-chain wallet addresses.
-- One address per ecosystem per user; one account per wallet address globally.

CREATE TABLE IF NOT EXISTS hub_user_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecosystem   TEXT NOT NULL CHECK (ecosystem IN ('minipay', 'base')),
  address     TEXT NOT NULL,                     -- lowercase 0x… EVM address
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One wallet address per ecosystem, globally (prevents one address → two accounts)
  UNIQUE (ecosystem, address),
  -- One ecosystem per user (they can update the address by unlinking/relinking)
  UNIQUE (user_id, ecosystem)
);

ALTER TABLE hub_user_wallets ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own wallets
CREATE POLICY "hub_wallets_select_own"
  ON hub_user_wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "hub_wallets_insert_own"
  ON hub_user_wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "hub_wallets_update_own"
  ON hub_user_wallets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "hub_wallets_delete_own"
  ON hub_user_wallets FOR DELETE
  USING (auth.uid() = user_id);
