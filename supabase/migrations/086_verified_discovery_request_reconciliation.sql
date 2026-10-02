-- Reconcile legacy open contribution requests without editing the already
-- deployable 085 migration. This migration is intentionally idempotent:
-- environments where 085 already created the partial unique index can run it
-- safely, while environments repaired before applying 085 reach the same
-- final state.

-- Open rows past their request window are truthful expired records.
UPDATE discovery_contribution_requests
SET state = 'expired'
WHERE state = 'open' AND expires_at < now();

-- Before the partial unique index existed, concurrent earning events could
-- create more than one open request for the same member and merchant. Keep
-- the oldest request (the same ordering used by the member's "next" lookup)
-- and make any later race-created rows ineligible.
WITH ranked_open_requests AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY hub_user_id, partner_id
      ORDER BY created_at ASC, id ASC
    ) AS position
  FROM discovery_contribution_requests
  WHERE state = 'open'
)
UPDATE discovery_contribution_requests AS request
SET state = 'ineligible'
FROM ranked_open_requests AS ranked
WHERE request.id = ranked.id
  AND ranked.position > 1;

-- Harmless when 085 already succeeded; required when reconciliation was
-- applied as an operational repair before the constraint migration reran.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_contribution_requests_open_per_member_merchant
  ON discovery_contribution_requests (hub_user_id, partner_id)
  WHERE state = 'open';
