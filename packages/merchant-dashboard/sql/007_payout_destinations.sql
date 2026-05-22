-- 007_payout_destinations.sql
-- Merchant-selected payout destinations for AkibaMiles payout processing.
-- Supports wallet, bank, and M-Pesa details. Server APIs decide which fields
-- are required based on payout_destination_type.

ALTER TABLE partner_settings
  ADD COLUMN IF NOT EXISTS payout_destination_type text NOT NULL DEFAULT 'wallet',
  ADD COLUMN IF NOT EXISTS payout_wallet text,
  ADD COLUMN IF NOT EXISTS payout_bank_name text,
  ADD COLUMN IF NOT EXISTS payout_bank_branch text,
  ADD COLUMN IF NOT EXISTS payout_bank_account_name text,
  ADD COLUMN IF NOT EXISTS payout_bank_account_number text,
  ADD COLUMN IF NOT EXISTS payout_mpesa_name text,
  ADD COLUMN IF NOT EXISTS payout_mpesa_phone text,
  ADD COLUMN IF NOT EXISTS payout_notes text,
  ADD COLUMN IF NOT EXISTS kes_exchange_rate numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partner_settings_payout_destination_type_check'
  ) THEN
    ALTER TABLE partner_settings
      ADD CONSTRAINT partner_settings_payout_destination_type_check
      CHECK (payout_destination_type IN ('wallet', 'bank', 'mpesa'));
  END IF;
END $$;

COMMENT ON COLUMN partner_settings.payout_destination_type IS 'Merchant payout preference: wallet, bank, or mpesa';
COMMENT ON COLUMN partner_settings.payout_wallet IS 'EVM address on Celo used when payout_destination_type=wallet';
COMMENT ON COLUMN partner_settings.payout_bank_name IS 'Bank name used when payout_destination_type=bank';
COMMENT ON COLUMN partner_settings.payout_bank_branch IS 'Bank branch used when payout_destination_type=bank';
COMMENT ON COLUMN partner_settings.payout_bank_account_name IS 'Bank account holder name used when payout_destination_type=bank';
COMMENT ON COLUMN partner_settings.payout_bank_account_number IS 'Bank account number used when payout_destination_type=bank';
COMMENT ON COLUMN partner_settings.payout_mpesa_name IS 'M-Pesa recipient name used when payout_destination_type=mpesa';
COMMENT ON COLUMN partner_settings.payout_mpesa_phone IS 'M-Pesa phone number used when payout_destination_type=mpesa';
COMMENT ON COLUMN partner_settings.payout_notes IS 'Merchant payout instructions visible to AkibaMiles finance admins';
COMMENT ON COLUMN partner_settings.kes_exchange_rate IS 'KES per 1 USD exchange rate used for this merchant';
