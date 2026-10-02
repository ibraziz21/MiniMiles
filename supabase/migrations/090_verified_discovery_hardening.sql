-- Verified Discovery — market-readiness hardening, Phase A safety release
-- (packages/hub-page/docs/verified-discovery-market-readiness-hardening-spec.md
-- §5.1, §5.6, §13 steps 1-3). This migration does three things:
--
-- 1. Adds a canonical, private eligibility projection for public verified
--    visits and customer photos (§5.1) so merchant-page and Discovery
--    queries stop hand-rolling the predicate (and, in one case, omitting it
--    entirely — the pre-hardening merchant-page photo gallery never checked
--    that a photo's underlying contribution/earning evidence was still
--    eligible, only that moderation_status='approved').
-- 2. Adds `suppressed_at` to contributions and photos so "no suppression is
--    active" (§4.1.7, §4.2.4) is an enforceable predicate, not aspirational
--    prose — nothing in this pass builds the admin suppression action
--    itself (§8.3 operational tooling), only the fail-closed column and the
--    projection's awareness of it.
-- 3. Makes photo moderation and its audit event atomic (§5.6): one
--    transaction locks the photo, validates an allowlisted reason code,
--    applies the transition, and inserts an immutable domain audit event.
--    The previous approve/reject route wrote its audit entry as a second,
--    independent call after the RPC returned — a crash or error between the
--    two left a moderated photo with no audit trail.
--
-- Not in this migration (explicitly deferred to the spec's P1 scale phase):
-- public snapshot tables, the projection job queue, and removing the
-- existing 500-row/other result caps in hub-page application code. Those
-- require the durable worker/backfill infrastructure in §5.2/§5.4, which
-- this pass does not build. The eligibility projection added here is a live
-- view/function, not a cache, so it needs no refresh queue to stay correct.

-- ── suppression columns (§4.1.7, §4.2.4) ────────────────────────────────
ALTER TABLE merchant_discovery_contributions
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;
ALTER TABLE merchant_visit_photos
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;

-- ── eligible_public_discovery_contributions (§5.1, §4.1) ────────────────
-- Internal-only view. Every predicate in §4.1 that establishes a
-- contribution is a public, active, positive, unsuppressed recommendation
-- at a published, structured-proof-enabled merchant lives here exactly
-- once. `dedup_key` lets callers apply the same-member/same-merchant/
-- same-day rule (§4.3) for ranking and aggregate thresholds without this
-- view — or anything built on it — ever returning hub_user_id.
CREATE OR REPLACE VIEW eligible_public_discovery_contributions AS
SELECT
  c.id AS contribution_id,
  c.partner_id,
  c.submitted_at,
  c.experience_option_ids,
  r.template_snapshot,
  md5(
    c.hub_user_id::text || ':' || c.partner_id::text || ':' ||
    to_char(date_trunc('day', c.submitted_at), 'YYYY-MM-DD')
  ) AS dedup_key
FROM merchant_discovery_contributions c
JOIN discovery_contribution_requests r ON r.id = c.request_id
JOIN verified_earning_events e ON e.id = r.earning_event_id
JOIN merchant_discovery_settings s ON s.partner_id = c.partner_id
JOIN partner_settings ps ON ps.partner_id = c.partner_id
JOIN partners pt ON pt.id = c.partner_id
WHERE c.withdrawn_at IS NULL
  AND c.suppressed_at IS NULL
  AND c.would_recommend = true
  AND r.state = 'submitted'
  AND e.verification_status = 'active'
  AND s.structured_proof_enabled = true
  AND ps.directory_status = 'published'
  AND pt.type = 'merchant'
  AND pt.status = 'active';

REVOKE ALL ON eligible_public_discovery_contributions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON eligible_public_discovery_contributions TO service_role;

-- ── eligible_public_merchant_visits (§5.1) ──────────────────────────────
-- The safe, hub_user_id-free read surface for merchant-page "Verified
-- visits" and the Discovery spotlight. p_partner_id narrows to one
-- merchant; NULL returns the full eligible corpus (still bounded by
-- whatever cap the caller applies — removing that cap entirely is the
-- separate, not-yet-built P1 full-corpus projection).
CREATE OR REPLACE FUNCTION eligible_public_merchant_visits(p_partner_id uuid DEFAULT NULL)
RETURNS TABLE (
  contribution_id        uuid,
  partner_id             uuid,
  submitted_at           timestamptz,
  experience_option_ids  text[],
  template_snapshot      jsonb,
  dedup_key              text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT contribution_id, partner_id, submitted_at, experience_option_ids, template_snapshot, dedup_key
  FROM eligible_public_discovery_contributions
  WHERE p_partner_id IS NULL OR partner_id = p_partner_id;
$$;

REVOKE ALL ON FUNCTION eligible_public_merchant_visits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION eligible_public_merchant_visits(uuid) TO service_role;

-- ── eligible_public_merchant_visit_photos (§5.1) ────────────────────────
-- Exactly the column set the spec names: never hub_user_id, source keys,
-- moderation reasons, raw labels, event identifiers or amounts. approved_at
-- is the one allowed non-ordering timestamp (safe ordering metadata).
CREATE OR REPLACE FUNCTION eligible_public_merchant_visit_photos(p_partner_id uuid DEFAULT NULL)
RETURNS TABLE (
  photo_id          uuid,
  contribution_id   uuid,
  partner_id        uuid,
  thumbnail_key     text,
  display_key       text,
  approved_at       timestamptz,
  qualified_item_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    p.contribution_id,
    p.partner_id,
    p.thumbnail_key,
    p.display_key,
    p.approved_at,
    NULL::uuid
  FROM merchant_visit_photos p
  JOIN eligible_public_discovery_contributions c ON c.contribution_id = p.contribution_id
  JOIN merchant_discovery_settings s ON s.partner_id = p.partner_id
  WHERE p.moderation_status = 'approved'
    AND p.thumbnail_key IS NOT NULL
    AND p.display_key IS NOT NULL
    AND p.withdrawn_at IS NULL
    AND p.suppressed_at IS NULL
    AND s.customer_photos_enabled = true
    AND (p_partner_id IS NULL OR p.partner_id = p_partner_id);
$$;

REVOKE ALL ON FUNCTION eligible_public_merchant_visit_photos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION eligible_public_merchant_visit_photos(uuid) TO service_role;

-- ── discovery_moderation_audit_events (§5.6) ────────────────────────────
-- The authoritative, append-only moderation record. admin_audit_logs (a
-- general-purpose table in the admin-dashboard's own schema) may still get
-- a best-effort copy for unified search, but this table is the one that
-- cannot be updated or deleted through any application role.
CREATE TABLE IF NOT EXISTS discovery_moderation_audit_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id                uuid NOT NULL REFERENCES merchant_visit_photos(id),
  actor_id                text,
  action                  text NOT NULL CHECK (action IN ('approve', 'reject')),
  reason_code             text,
  before_status           text NOT NULL,
  after_status            text NOT NULL,
  request_correlation_id  text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_moderation_audit_events_photo
  ON discovery_moderation_audit_events (photo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_moderation_audit_events_actor
  ON discovery_moderation_audit_events (actor_id, created_at DESC);

ALTER TABLE discovery_moderation_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discovery_moderation_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON discovery_moderation_audit_events TO service_role;

CREATE OR REPLACE FUNCTION reject_discovery_moderation_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'discovery_moderation_audit_events is append-only: mutations are not permitted'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_discovery_moderation_audit_no_mutation ON discovery_moderation_audit_events;
CREATE TRIGGER trg_discovery_moderation_audit_no_mutation
  BEFORE UPDATE OR DELETE ON discovery_moderation_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_discovery_moderation_audit_mutation();

-- ── atomic perform_visit_photo_transition (§5.6) ────────────────────────
-- Signature grows by two optional parameters (actor id, request correlation
-- id), so the previous 3-argument overload must be dropped explicitly —
-- otherwise Postgres keeps both and a 3-named-argument call from an
-- un-migrated caller becomes an ambiguous-overload error instead of a clean
-- call to the new function.
DROP FUNCTION IF EXISTS perform_visit_photo_transition(uuid, text, text);

CREATE OR REPLACE FUNCTION perform_visit_photo_transition(
  p_photo_id        uuid,
  p_action          text,
  p_reason_code     text DEFAULT NULL,
  p_actor_id        text DEFAULT NULL,
  p_correlation_id  text DEFAULT NULL
) RETURNS TABLE(ok boolean, photo jsonb, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row            merchant_visit_photos;
  v_before_status  text;
  v_recent_actions integer;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_action'::text;
    RETURN;
  END IF;

  -- Rate limiting "appropriate to an authenticated admin workflow" (§5.6):
  -- no admin legitimately approves/rejects more than 30 photos a minute.
  SELECT count(*) INTO v_recent_actions
  FROM discovery_moderation_audit_events
  WHERE actor_id IS NOT DISTINCT FROM p_actor_id
    AND created_at > now() - interval '1 minute';
  IF v_recent_actions >= 30 THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'rate_limited'::text;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM merchant_visit_photos WHERE id = p_photo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;

  IF v_row.moderation_status <> 'pending' THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_transition'::text;
    RETURN;
  END IF;
  v_before_status := v_row.moderation_status;

  IF p_action = 'approve' THEN
    UPDATE merchant_visit_photos
    SET moderation_status = 'approved', approved_at = now(), moderation_reason_code = NULL
    WHERE id = p_photo_id
    RETURNING * INTO v_row;
  ELSE
    IF p_reason_code IS NULL OR length(p_reason_code) > 64 OR p_reason_code NOT IN (
      'policy_violation', 'identifiable_person', 'low_quality',
      'not_merchant_related', 'receipt_or_personal_info',
      'duplicate_or_reused', 'other'
    ) THEN
      RETURN QUERY SELECT false, NULL::jsonb, 'reason_required'::text;
      RETURN;
    END IF;
    UPDATE merchant_visit_photos
    SET moderation_status = 'rejected', moderation_reason_code = p_reason_code
    WHERE id = p_photo_id
    RETURNING * INTO v_row;
  END IF;

  -- Same transaction as the state transition above: either both the status
  -- change and its audit event commit, or (on any error here) both roll
  -- back. No code path can produce a moderated photo without an audit row.
  INSERT INTO discovery_moderation_audit_events (
    photo_id, actor_id, action, reason_code, before_status, after_status, request_correlation_id
  ) VALUES (
    p_photo_id, p_actor_id, p_action, p_reason_code, v_before_status, v_row.moderation_status, p_correlation_id
  );

  RETURN QUERY SELECT true, to_jsonb(v_row), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION perform_visit_photo_transition(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION perform_visit_photo_transition(uuid, text, text, text, text)
  TO service_role;
