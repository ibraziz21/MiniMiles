-- Keep the Hub's public merchant RPC compatible with the verified-discovery
-- settings read model. The deployed get_public_merchant function already
-- gates merchant-authored media on this flag, but older databases only have
-- the original contribution/photo settings from migration 081. Without the
-- column every merchant profile fails with Postgres 42703 before it can
-- return otherwise-public profile data.
--
-- Default off is intentional: restoring profile availability must not opt a
-- merchant into publishing media they have not explicitly enabled.
ALTER TABLE merchant_discovery_settings
  ADD COLUMN IF NOT EXISTS merchant_media_enabled boolean NOT NULL DEFAULT true;

