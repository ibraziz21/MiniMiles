-- 009_partner_banner_image.sql
-- Adds a merchant-editable cover/banner image, alongside the existing
-- `logo_url` (003_phase2_tables.sql). Requested to replace the flat-color
-- header + tiny centered logo used by Hub's merchant cards
-- (packages/hub-page/src/components/home/MerchantValueCard.tsx) with a real
-- cover photo when a merchant has one. Optional — nullable, no default;
-- Hub falls back to its existing logo-based treatment when unset.

ALTER TABLE partner_settings
  ADD COLUMN IF NOT EXISTS banner_url text;
