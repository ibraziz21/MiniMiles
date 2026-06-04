-- merchant_security_constraints.sql
-- Adds DB-level uniqueness and safety constraints that back application-level
-- checks with hard guarantees. Run once after all previous migrations.

-- ── 1. payment_ref uniqueness ────────────────────────────────────────────────
-- Prevents two orders being created from the same on-chain tx hash even if
-- concurrent requests both pass the application-level replay check.
create unique index if not exists uq_mt_payment_ref
  on merchant_transactions (payment_ref)
  where payment_ref is not null;

-- ── 2. issued_vouchers — unique code per non-terminal rows ──────────────────
-- Voucher codes are generated with crypto.getRandomValues; the DB constraint
-- is the safety net for the (rare) collision case.
-- "pending" and "claiming" rows are included so a collision is caught early.
create unique index if not exists uq_iv_code
  on issued_vouchers (code)
  where status not in ('void');

-- ── 2a. issued_vouchers — status values used by the application ──────────────
-- The application writes: pending, issued, claiming, redeemed, void.
-- If the table has a CHECK constraint on status, ensure these values are allowed.
-- Run this manually in the Supabase SQL editor if you hit a constraint violation:
--
--   ALTER TABLE issued_vouchers
--     DROP CONSTRAINT IF EXISTS issued_vouchers_status_check;
--   ALTER TABLE issued_vouchers
--     ADD CONSTRAINT issued_vouchers_status_check
--     CHECK (status IN ('pending', 'issued', 'claiming', 'redeemed', 'void'));

-- ── 3. issued_vouchers — unique idempotency_key ──────────────────────────────
-- Backs the application-level idempotency check so concurrent retries cannot
-- insert two vouchers for the same key.
create unique index if not exists uq_iv_idempotency_key
  on issued_vouchers (idempotency_key)
  where idempotency_key is not null;

-- ── 4. voucher_issue_nonces — unique nonce ───────────────────────────────────
-- Must already exist for the nonce-first strategy to serialize concurrent
-- requests. Added here as a belt-and-suspenders guard.
create unique index if not exists uq_vin_nonce
  on voucher_issue_nonces (nonce);
