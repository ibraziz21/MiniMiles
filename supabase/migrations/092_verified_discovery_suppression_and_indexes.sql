-- Verified Discovery — emergency suppression and eligibility-predicate
-- indexes (packages/hub-page/docs/verified-discovery-market-readiness-
-- hardening-spec.md §7.1 "Emergency suppression quarantines or removes
-- public derivatives so retained signed URLs stop working within five
-- minutes", §8.3 "suppress a photo... immediately", §9 "Snapshot and
-- eligibility predicates have indexes verified with production-shaped
-- EXPLAIN (ANALYZE, BUFFERS) plans").
--
-- Scope note: 090 added `suppressed_at` columns and the eligibility
-- projection already honors them; nothing before this migration could
-- actually SET one. This adds the one atomic, audited admin action that
-- does — scoped to photos and contributions, the two tables this repo
-- owns. A merchant-wide proof kill is the existing env-var kill switches
-- (lib/akiba/verifiedDiscoveryPublicProofFlags.ts) — global, not
-- per-merchant, because partner_settings/partners/merchant_discovery_settings
-- are Akiba-Platform-owned synced tables this repo does not write to.

-- ── audit action enum: add suppress/unsuppress ──────────────────────────
ALTER TABLE discovery_moderation_audit_events DROP CONSTRAINT IF EXISTS discovery_moderation_audit_events_action_check;
ALTER TABLE discovery_moderation_audit_events
  ADD CONSTRAINT discovery_moderation_audit_events_action_check
  CHECK (action IN ('approve', 'reject', 'suppress', 'unsuppress'));

-- ── set_visit_photo_suppression (§7.1, §8.3) ────────────────────────────
-- Suppression is independent of moderation_status — an already-approved
-- (and therefore currently public) photo is exactly the case this exists
-- for. Unlike perform_visit_photo_transition, this does not require
-- 'pending' status and does not change moderation_status; it only flips
-- suppressed_at, which the canonical eligibility projection (090) already
-- checks on every read, so a suppressed photo stops being publicly
-- eligible the instant this commits — no separate revocation step, no
-- five-minute wait for a cache to expire, because nothing here is cached.
CREATE OR REPLACE FUNCTION set_visit_photo_suppression(
  p_photo_id       uuid,
  p_suppressed     boolean,
  p_actor_id       text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  p_reason_code    text DEFAULT NULL
) RETURNS TABLE(ok boolean, photo jsonb, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row            merchant_visit_photos;
  v_recent_actions integer;
  v_was_suppressed boolean;
BEGIN
  SELECT count(*) INTO v_recent_actions
  FROM discovery_moderation_audit_events
  WHERE actor_id IS NOT DISTINCT FROM p_actor_id
    AND created_at > now() - interval '1 minute';
  IF v_recent_actions >= 30 THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'rate_limited'::text;
    RETURN;
  END IF;

  IF NOT p_suppressed AND (p_reason_code IS NOT NULL AND length(p_reason_code) > 64) THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'reason_too_long'::text;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM merchant_visit_photos WHERE id = p_photo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;

  v_was_suppressed := v_row.suppressed_at IS NOT NULL;
  IF v_was_suppressed = p_suppressed THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_transition'::text;
    RETURN;
  END IF;

  UPDATE merchant_visit_photos
  SET suppressed_at = CASE WHEN p_suppressed THEN now() ELSE NULL END
  WHERE id = p_photo_id
  RETURNING * INTO v_row;

  INSERT INTO discovery_moderation_audit_events (
    photo_id, actor_id, action, reason_code, before_status, after_status, request_correlation_id
  ) VALUES (
    p_photo_id, p_actor_id,
    CASE WHEN p_suppressed THEN 'suppress' ELSE 'unsuppress' END,
    p_reason_code,
    CASE WHEN v_was_suppressed THEN 'suppressed' ELSE 'unsuppressed' END,
    CASE WHEN p_suppressed THEN 'suppressed' ELSE 'unsuppressed' END,
    p_correlation_id
  );

  PERFORM enqueue_merchant_discovery_projection_refresh(v_row.partner_id, 'photo_suppression');

  RETURN QUERY SELECT true, to_jsonb(v_row), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION set_visit_photo_suppression(uuid, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_visit_photo_suppression(uuid, boolean, text, text, text)
  TO service_role;

-- ── eligibility-predicate indexes (§9) ──────────────────────────────────
-- Partial indexes shaped exactly like eligible_public_discovery_contributions
-- and eligible_public_merchant_visit_photos' WHERE clauses (090), so the
-- planner can satisfy "eligible rows for partner X, newest first" as an
-- index-only range scan instead of a sequential scan as these tables grow
-- past pilot scale.
CREATE INDEX IF NOT EXISTS idx_merchant_discovery_contributions_eligible
  ON merchant_discovery_contributions (partner_id, submitted_at DESC)
  WHERE withdrawn_at IS NULL AND suppressed_at IS NULL AND would_recommend = true;

CREATE INDEX IF NOT EXISTS idx_merchant_visit_photos_eligible
  ON merchant_visit_photos (partner_id, approved_at DESC)
  WHERE moderation_status = 'approved' AND withdrawn_at IS NULL AND suppressed_at IS NULL;
