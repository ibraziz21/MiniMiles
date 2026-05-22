-- ── Finance: wallet address for payment details ───────────────────────────────
-- Adds a wallet_address column to partner_settings so merchants can record
-- their Celo/EVM address for receiving payments and invoice generation.

ALTER TABLE partner_settings
  ADD COLUMN IF NOT EXISTS wallet_address text;
