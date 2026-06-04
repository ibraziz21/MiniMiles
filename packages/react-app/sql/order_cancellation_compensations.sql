-- order_cancellation_compensations.sql
-- Records compensation actions taken when a merchant order is cancelled.
-- This is the support queue for manual refund execution.
-- Run once. Safe to re-run.

create table if not exists order_cancellation_compensations (
  id                  uuid        primary key default gen_random_uuid(),
  order_id            uuid        not null references merchant_transactions(id) on delete cascade,
  user_address        text        not null,
  partner_id          uuid        not null,
  amount_cusd         numeric,
  payment_ref         text,                    -- on-chain tx hash paid by user
  payment_currency    text,
  voucher_id          uuid,
  voucher_reinstated  boolean     not null default false,
  -- refund_status tracks the manual operator refund workflow
  refund_status       text        not null default 'pending_manual'
                        check (refund_status in ('pending_manual', 'refunded', 'not_applicable')),
  refund_tx_hash      text,                    -- set by operator after executing on-chain refund
  resolved_at         timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);

create unique index if not exists uq_occ_order_id
  on order_cancellation_compensations (order_id);

create index if not exists idx_occ_refund_status
  on order_cancellation_compensations (refund_status)
  where refund_status = 'pending_manual';
