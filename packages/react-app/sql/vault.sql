-- Akiba Vaults — Supabase schema
-- Run once against the production database.
--
-- Three tables:
--   vault_positions        — current akUSDT balance per wallet (event-watcher maintained)
--   vault_events           — immutable audit log of every deposit/withdrawal
--   vault_reward_snapshots — idempotency guard for the daily Miles reward scheduler

-- ── vault_positions ───────────────────────────────────────────────────────────
-- Upserted by the event watcher on every Deposited / Withdrawn on-chain event.
-- balance_usdt mirrors the user's akUSDT balance (their principal).

CREATE TABLE IF NOT EXISTS vault_positions (
  wallet_address  text        PRIMARY KEY,
  balance_usdt    numeric(20,6) NOT NULL DEFAULT 0 CHECK (balance_usdt >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  vault_positions IS 'Current USDT principal held per wallet in the Akiba Vault.';
COMMENT ON COLUMN vault_positions.balance_usdt IS 'Mirrors akUSDT balance — updated by event watcher.';

-- ── vault_events ──────────────────────────────────────────────────────────────
-- Append-only event log. tx_hash unique prevents duplicate inserts on retry.

CREATE TABLE IF NOT EXISTS vault_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text        NOT NULL,
  event_type      text        NOT NULL CHECK (event_type IN ('deposit', 'withdrawal')),
  amount_usdt     numeric(20,6) NOT NULL CHECK (amount_usdt > 0),
  tx_hash         text        NOT NULL UNIQUE,
  block_number    bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_events_wallet_created
  ON vault_events (wallet_address, created_at DESC);

COMMENT ON TABLE  vault_events IS 'Immutable audit log of on-chain Deposited / Withdrawn events.';

-- ── vault_reward_snapshots ────────────────────────────────────────────────────
-- One row per calendar day.  Inserted as pending before the run starts;
-- updated to completed once all mint jobs are enqueued.
-- The scheduler checks for today's row before doing any work (idempotency guard).

CREATE TABLE IF NOT EXISTS vault_reward_snapshots (
  snapshot_date       date        PRIMARY KEY,
  total_wallets       int,
  total_miles_queued  bigint,
  completed_at        timestamptz
);

COMMENT ON TABLE vault_reward_snapshots IS
  'Daily reward run log. Presence of a row for today prevents double-runs.';

-- ── vault_watcher_state ───────────────────────────────────────────────────────
-- Stores the last processed block so the event watcher can resume after restart.

CREATE TABLE IF NOT EXISTS vault_watcher_state (
  key             text PRIMARY KEY,
  last_block      bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the initial state row
INSERT INTO vault_watcher_state (key, last_block)
VALUES ('default', 0)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE vault_watcher_state IS
  'Persistent cursor for the vault event watcher (last processed block number).';

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- All tables are server-only (service key access).  No anon/authenticated policies.

ALTER TABLE vault_positions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_reward_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_watcher_state    ENABLE ROW LEVEL SECURITY;
