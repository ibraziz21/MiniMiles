-- Verified Discovery V1 — earning reversal/dispute/reinstatement
-- (verified-discovery-acquisition-v1-spec.md §10.4, §11.1, §13.3, §8.5).
-- `verified_earning_events.verification_status` was already append-style,
-- but a bare UPDATE loses the history of multiple transitions (reversed,
-- then reinstated, then disputed again) and the spec is explicit that
-- "status changes require a durable reversal or dispute event and an audit
-- record" — so this adds a real event log, not just an in-place flag flip.

-- ── verified_earning_event_status_changes ───────────────────────────────
CREATE TABLE IF NOT EXISTS verified_earning_event_status_changes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_change_event_id  text NOT NULL UNIQUE,
  earning_event_id        uuid NOT NULL REFERENCES verified_earning_events(id),
  from_status             text NOT NULL,
  to_status               text NOT NULL CHECK (to_status IN ('active', 'reversed', 'disputed')),
  reason                  text,
  source                  text NOT NULL DEFAULT 'internal_api',
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verified_earning_event_status_changes_event
  ON verified_earning_event_status_changes (earning_event_id, created_at DESC);

ALTER TABLE verified_earning_event_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON verified_earning_event_status_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON verified_earning_event_status_changes TO service_role;

-- ── apply_verified_earning_status_change ────────────────────────────────
-- Idempotent on status_change_event_id (a retried reversal/dispute/
-- reinstatement call is a no-op the second time, same contract as
-- verified_earning_events itself on event_id). Cascades to any in-flight
-- discovery_contribution_requests:
--   reversed/disputed -> 'open'/'submitted' requests become 'ineligible'
--     (§8.5: "A reversed or disputed earning event makes the contribution
--     ineligible");
--   active (reinstatement) -> an 'ineligible' request this same earning
--     event caused is restored to 'submitted' (a contribution was already
--     saved), 'open' (none was), or 'expired' (time has since passed) —
--     never to a state the member separately dismissed/let expire on
--     their own, since this only touches rows currently 'ineligible'.
--
-- Known boundary: this does not retroactively re-run item qualification
-- (qualify_discovery_item_if_eligible) for items whose only qualifying
-- mentions came from a now-reversed event. That's a fuller aggregate-
-- recomputation concern for Stage 3, not reproduced here.
CREATE OR REPLACE FUNCTION apply_verified_earning_status_change(
  p_status_change_event_id text,
  p_event_id               uuid,
  p_to_status              text,
  p_reason                 text DEFAULT NULL,
  p_source                 text DEFAULT 'internal_api'
) RETURNS TABLE(ok boolean, applied boolean, from_status text, to_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row                 verified_earning_events;
  v_existing_change_id  uuid;
  v_from_status         text;
BEGIN
  IF p_to_status NOT IN ('active', 'reversed', 'disputed') THEN
    RETURN QUERY SELECT false, false, NULL::text, p_to_status;
    RETURN;
  END IF;

  SELECT id INTO v_existing_change_id
  FROM verified_earning_event_status_changes
  WHERE status_change_event_id = p_status_change_event_id;
  IF v_existing_change_id IS NOT NULL THEN
    RETURN QUERY SELECT true, false, NULL::text, p_to_status;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM verified_earning_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::text, p_to_status;
    RETURN;
  END IF;

  v_from_status := v_row.verification_status;

  IF v_from_status = p_to_status THEN
    -- Already in the target state — still record the audit row (a
    -- duplicate confirmation under a genuinely new status_change_event_id
    -- is evidence, not noise) but there's nothing further to cascade.
    INSERT INTO verified_earning_event_status_changes
      (status_change_event_id, earning_event_id, from_status, to_status, reason, source)
    VALUES (p_status_change_event_id, v_row.id, v_from_status, p_to_status, p_reason, p_source);
    RETURN QUERY SELECT true, false, v_from_status, p_to_status;
    RETURN;
  END IF;

  UPDATE verified_earning_events
  SET verification_status = p_to_status, updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO verified_earning_event_status_changes
    (status_change_event_id, earning_event_id, from_status, to_status, reason, source)
  VALUES (p_status_change_event_id, v_row.id, v_from_status, p_to_status, p_reason, p_source);

  IF p_to_status IN ('reversed', 'disputed') THEN
    UPDATE discovery_contribution_requests
    SET state = 'ineligible'
    WHERE earning_event_id = v_row.id AND state IN ('open', 'submitted');
  ELSIF p_to_status = 'active' THEN
    UPDATE discovery_contribution_requests r
    SET state = CASE
      WHEN r.expires_at < now() THEN 'expired'
      WHEN EXISTS (
        SELECT 1 FROM merchant_discovery_contributions c
        WHERE c.request_id = r.id AND c.withdrawn_at IS NULL
      ) THEN 'submitted'
      ELSE 'open'
    END
    WHERE r.earning_event_id = v_row.id AND r.state = 'ineligible';
  END IF;

  RETURN QUERY SELECT true, true, v_from_status, p_to_status;
END;
$$;

REVOKE ALL ON FUNCTION apply_verified_earning_status_change(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_verified_earning_status_change(text, uuid, text, text, text)
  TO service_role;
