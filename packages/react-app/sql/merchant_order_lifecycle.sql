-- merchant_order_lifecycle.sql
-- Adds delivery details, lifecycle timestamps, and reward tracking to
-- merchant_transactions for a complete merchant order flow.
--
-- Run once against your Supabase project.

-- ── 1. Delivery details (persisted at order creation) ───────────────────────
alter table merchant_transactions
  add column if not exists recipient_name   text,
  add column if not exists phone            text,
  add column if not exists city             text,
  add column if not exists location_details text;

-- ── 2. Lifecycle timestamps ──────────────────────────────────────────────────
-- Each column is set (once) when the order enters that state.
alter table merchant_transactions
  add column if not exists accepted_at      timestamptz,
  add column if not exists packed_at        timestamptz,
  add column if not exists dispatched_at    timestamptz,  -- out_for_delivery
  add column if not exists delivered_at     timestamptz,
  add column if not exists received_at      timestamptz,  -- customer confirmed
  add column if not exists cancelled_at     timestamptz,
  add column if not exists completed_at     timestamptz;  -- reward enqueued + order finalised

-- ── 3. AkibaMiles reward tracking ───────────────────────────────────────────
alter table merchant_transactions
  add column if not exists miles_reward_status
    text not null default 'pending'
    check (miles_reward_status in ('pending', 'queued', 'sent', 'failed')),
  add column if not exists miles_reward_attempts  integer not null default 0,
  add column if not exists miles_reward_tx_hash   text;

-- ── 4. Expand the tx_status enum with the full lifecycle values ─────────────
-- Postgres enums require ALTER TYPE ... ADD VALUE; IF NOT EXISTS is PG 9.3+.
-- Values are appended in order — existing rows are unaffected.
alter type tx_status add value if not exists 'placed';
alter type tx_status add value if not exists 'accepted';
alter type tx_status add value if not exists 'packed';
alter type tx_status add value if not exists 'out_for_delivery';
alter type tx_status add value if not exists 'delivered';
alter type tx_status add value if not exists 'received';
alter type tx_status add value if not exists 'completed';
alter type tx_status add value if not exists 'cancelled';

-- ── 5. Indexes for merchant dashboard + reward worker queries ────────────────
create index if not exists idx_mt_status_created
  on merchant_transactions (status, created_at desc);

create index if not exists idx_mt_partner_status
  on merchant_transactions (partner_id, status);

create index if not exists idx_mt_reward_pending
  on merchant_transactions (miles_reward_status)
  where miles_reward_status = 'pending';
