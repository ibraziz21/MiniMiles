-- claw_voucher_redemptions.sql
-- Audit log for every claw voucher redemption attempt made by a merchant user.
-- Written by POST /api/merchant/claw-vouchers/redeem (merchant-dashboard).
-- Rows are append-only — never updated or deleted.

CREATE TABLE IF NOT EXISTS claw_voucher_redemptions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Merchant identity (from iron-session at redemption time)
  merchant_user_id  uuid        NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
  partner_id        uuid        NOT NULL,  -- denormalised for fast per-partner queries

  -- Voucher being redeemed
  voucher_id        text        NOT NULL,  -- on-chain uint256 as text

  -- QR payload fields, validated server-side before calling markRedeemed
  owner_address     text        NOT NULL,  -- claimed voucher owner from QR
  expires_at_unix   bigint      NOT NULL,  -- expiresAt from QR payload

  -- Outcome
  success           boolean     NOT NULL DEFAULT false,
  failure_reason    text,                  -- null on success
  on_chain_tx_hash  text,                  -- null on failure

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cvr_partner_created
  ON claw_voucher_redemptions (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cvr_voucher_id
  ON claw_voucher_redemptions (voucher_id);
CREATE INDEX IF NOT EXISTS idx_cvr_merchant_user
  ON claw_voucher_redemptions (merchant_user_id);

-- Immutable: never update or delete redemption log rows
CREATE OR REPLACE RULE no_update_cvr AS ON UPDATE TO claw_voucher_redemptions DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_cvr AS ON DELETE TO claw_voucher_redemptions DO INSTEAD NOTHING;

-- RLS: only accessible via service role (server-side API)
ALTER TABLE claw_voucher_redemptions ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies — service role bypasses RLS.
