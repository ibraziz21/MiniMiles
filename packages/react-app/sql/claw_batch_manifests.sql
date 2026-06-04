-- Server-only storage for Akiba Claw Merkle batch manifests.
-- These rows contain reward outcomes and Merkle proofs. Never expose this table
-- to browser clients. Use only with SUPABASE_SERVICE_KEY on trusted backends.

CREATE TABLE IF NOT EXISTS claw_batch_manifests (
  batch_id      text PRIMARY KEY,
  merkle_root   text NOT NULL,
  total_plays   integer NOT NULL CHECK (total_plays > 0),
  counts        jsonb NOT NULL,
  manifest      jsonb NOT NULL,
  opened_tx     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  opened_at     timestamptz
);

ALTER TABLE claw_batch_manifests ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies are created. Supabase service role bypasses
-- RLS and is the only intended access path.
