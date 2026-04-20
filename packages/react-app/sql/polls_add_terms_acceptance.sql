-- Migration: add terms acceptance audit fields to poll responses
--
-- Stores the exact poll terms version accepted at submission time. This is
-- required because Verified Insights responses are linked to a wallet and may
-- include demographic answers.

ALTER TABLE poll_responses
  ADD COLUMN IF NOT EXISTS accepted_terms bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz;

COMMENT ON COLUMN poll_responses.accepted_terms IS
  'Whether the wallet accepted the poll terms before submission.';

COMMENT ON COLUMN poll_responses.terms_version IS
  'Version identifier for the poll terms accepted by the wallet.';

COMMENT ON COLUMN poll_responses.accepted_terms_at IS
  'Timestamp when the wallet accepted the poll terms.';
