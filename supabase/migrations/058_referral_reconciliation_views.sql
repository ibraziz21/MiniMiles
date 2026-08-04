-- 058_referral_reconciliation_views.sql
-- Referral reconciliation queues (referral-system-spec.md §14.3), matching
-- the existing v_stuck_orders/v_stale_refunds/v_open_disputes convention
-- (036_disputes_notifications_reconciliation.sql): live queries over
-- current state, not a scheduled job writing incident rows — an empty
-- queue *is* the reconciled state, re-derived on every read rather than
-- persisted and going stale.
--
-- Not implementable yet: "released referral_reward_jobs against Platform
-- ledger references" (§14.3's first bullet) needs a Platform-side ledger
-- lookup-by-reference endpoint that doesn't exist in the confirmed
-- contract (only credit + reverse). The 4 views below cover every
-- discrepancy checkable from Hub's own data.

-- ── Budget bookkeeping vs. actual released jobs ──────────────────────────
-- released_budget_miles should always equal the sum of amount_miles for
-- that program version's released jobs — a drift here means a bug in the
-- budget-adjusting code path, not a Platform-side problem.

CREATE OR REPLACE VIEW v_referral_budget_discrepancies AS
SELECT
  pv.id AS program_version_id,
  pv.version,
  pv.status,
  pv.released_budget_miles AS recorded_released,
  COALESCE(SUM(j.amount_miles) FILTER (WHERE j.status = 'released'), 0) AS actual_released,
  pv.released_budget_miles - COALESCE(SUM(j.amount_miles) FILTER (WHERE j.status = 'released'), 0) AS discrepancy
FROM referral_program_versions pv
LEFT JOIN hub_referrals r ON r.program_version_id = pv.id
LEFT JOIN referral_reward_jobs j ON j.referral_id = r.id
GROUP BY pv.id, pv.version, pv.status, pv.released_budget_miles
HAVING pv.released_budget_miles <> COALESCE(SUM(j.amount_miles) FILTER (WHERE j.status = 'released'), 0);

-- ── Completed hub_referrals against their two reward jobs ────────────────────
-- A referral marked 'complete' must have exactly its expected count of
-- released jobs (2: signup + activation); conversely, a referral with both
-- jobs released must be marked 'complete' (complete_referral_reward_job
-- sets this atomically, so a mismatch means something wrote to one side
-- without the other, e.g. a manual DB edit).

CREATE OR REPLACE VIEW v_referral_completion_mismatches AS
SELECT
  r.id AS referral_id,
  r.status,
  count(j.id) AS total_jobs,
  count(j.id) FILTER (WHERE j.status = 'released') AS released_jobs
FROM hub_referrals r
JOIN referral_reward_jobs j ON j.referral_id = r.id
GROUP BY r.id, r.status
HAVING
  (r.status = 'complete' AND count(j.id) FILTER (WHERE j.status = 'released') < count(j.id))
  OR (r.status <> 'complete' AND count(j.id) = 2 AND count(j.id) FILTER (WHERE j.status = 'released') = 2);

-- ── Jobs processing beyond their lease (§14.2 "any job processing beyond
--    its lease" alert) ────────────────────────────────────────────────
-- claim_referral_reward_jobs/claim_referral_reversal_jobs both reclaim a
-- stale 'processing' row the moment they next run, so a nonempty result
-- here for longer than one worker interval means the worker itself has
-- stopped running, not that any single job is unrecoverable.

CREATE OR REPLACE VIEW v_referral_stuck_processing AS
SELECT id, referral_id, milestone, status, released_at, lease_owner, lease_expires_at, attempts
FROM referral_reward_jobs
WHERE status = 'processing' AND lease_expires_at < now() - interval '10 minutes';

-- ── Eligible backlog age over 15 minutes (§14.2) ─────────────────────────
-- Covers both directions: a credit job sitting past its eligible_at, and a
-- reversal sitting past the moment it was requested (reversal_pending has
-- no separate eligible_at column — it's due immediately on entry, so
-- updated_at is the right staleness clock for it).

CREATE OR REPLACE VIEW v_referral_backlog AS
SELECT id, referral_id, milestone, status, recipient_user_id, eligible_at AS due_since
FROM referral_reward_jobs
WHERE status IN ('pending_hold', 'eligible') AND eligible_at < now() - interval '15 minutes'
UNION ALL
SELECT id, referral_id, milestone, status, recipient_user_id, updated_at AS due_since
FROM referral_reward_jobs
WHERE status = 'reversal_pending' AND updated_at < now() - interval '15 minutes';

GRANT SELECT ON v_referral_budget_discrepancies, v_referral_completion_mismatches,
  v_referral_stuck_processing, v_referral_backlog TO service_role;

NOTIFY pgrst, 'reload schema';
