-- Verified Discovery — durable public snapshots and projection queue
-- (packages/hub-page/docs/verified-discovery-market-readiness-hardening-spec.md
-- §5.2, §5.3, §5.4, §12 Phase B). This is the P1 "scale" step of the
-- hardening implementation sequence: it builds the snapshot/queue
-- infrastructure and computes it, but does NOT wire any public read path to
-- serve it yet — per the spec's own rollout plan, V2 runs in shadow for
-- seven consecutive healthy days before any traffic cutover. Application
-- code (merchant page, home spotlight) keeps reading the live, canonical-
-- eligibility-backed queries from 090 until that shadow period is reviewed
-- and a separate migration/deploy flips the read path.
--
-- Deliberately out of scope for this pass: the shadow-vs-live comparison
-- tooling itself (§12 Phase B's "compare... with a complete reference
-- query") is an operational exercise run against real data over days, not
-- something a migration can produce; the canary rollout (§12 Phase C) and
-- removing the old 500-row-capped spotlight path (§12 Phase D) come after
-- that review.

-- ── merchant_discovery_public_snapshots (§5.2) ──────────────────────────
CREATE TABLE IF NOT EXISTS merchant_discovery_public_snapshots (
  partner_id                   uuid PRIMARY KEY REFERENCES partners(id),
  ranking_version              integer NOT NULL,
  active_positive_unique_count integer NOT NULL,
  public_count_band            text,
  qualified_experience_labels  jsonb NOT NULL DEFAULT '[]'::jsonb,
  qualified_recommended_items  jsonb NOT NULL DEFAULT '[]'::jsonb,
  cover_photo_id               uuid,
  rank_score                   numeric NOT NULL,
  source_window_start          timestamptz NOT NULL,
  source_window_end            timestamptz NOT NULL,
  generated_at                 timestamptz NOT NULL,
  source_watermark             text,
  suppression_reason           text
);

ALTER TABLE merchant_discovery_public_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_public_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_public_snapshots TO service_role;

-- ── merchant_discovery_projection_jobs (§5.4) ───────────────────────────
CREATE TABLE IF NOT EXISTS merchant_discovery_projection_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES partners(id),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  reason        text,
  next_retry_at timestamptz,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_discovery_projection_jobs_pending
  ON merchant_discovery_projection_jobs (next_retry_at) WHERE status = 'pending';

-- "Repeated events for one partner coalesce into one pending refresh"
-- (§5.4): at most one pending row per partner, enforced the same way
-- idempotent request dedup works elsewhere in this schema — a partial
-- unique index plus ON CONFLICT DO NOTHING on the enqueue path.
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_discovery_projection_jobs_pending_partner
  ON merchant_discovery_projection_jobs (partner_id) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_merchant_discovery_projection_jobs_touch ON merchant_discovery_projection_jobs;
CREATE TRIGGER trg_merchant_discovery_projection_jobs_touch
  BEFORE UPDATE ON merchant_discovery_projection_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE merchant_discovery_projection_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_projection_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_projection_jobs TO service_role;

CREATE OR REPLACE FUNCTION enqueue_merchant_discovery_projection_refresh(
  p_partner_id uuid,
  p_reason     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_partner_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO merchant_discovery_projection_jobs (partner_id, reason)
  VALUES (p_partner_id, p_reason)
  ON CONFLICT (partner_id) WHERE status = 'pending' DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_merchant_discovery_projection_refresh(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_merchant_discovery_projection_refresh(uuid, text)
  TO service_role;

-- A cron or scheduled worker is the durable path (§5.4). Workers claim with
-- FOR UPDATE SKIP LOCKED and bounded batches, reclaiming stale processing
-- leases the same way 089 already does for photo_processing_jobs.
CREATE OR REPLACE FUNCTION claim_merchant_discovery_projection_jobs(p_limit integer DEFAULT 25)
RETURNS SETOF merchant_discovery_projection_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE merchant_discovery_projection_jobs
  SET status = 'failed', attempts = attempts + 1, reason = 'worker_lease_expired', updated_at = now()
  WHERE status = 'processing' AND locked_at < now() - interval '10 minutes' AND attempts >= 5;

  RETURN QUERY
  UPDATE merchant_discovery_projection_jobs AS job
  SET status = 'processing',
      locked_at = now(),
      attempts = job.attempts + CASE WHEN job.status = 'processing' THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE job.id IN (
    SELECT candidate.id
    FROM merchant_discovery_projection_jobs AS candidate
    WHERE (
        candidate.status = 'pending'
        AND (candidate.next_retry_at IS NULL OR candidate.next_retry_at <= now())
      ) OR (
        candidate.status = 'processing'
        AND candidate.locked_at < now() - interval '10 minutes'
        AND candidate.attempts < 5
      )
    ORDER BY candidate.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_merchant_discovery_projection_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_merchant_discovery_projection_jobs(integer) TO service_role;

-- ── recompute_merchant_discovery_snapshot (§5.3 Ranking V1) ─────────────
-- Unlike photo processing, this has no external I/O (no decoding, no
-- storage) — the entire computation is SQL, so one function does the full
-- claim-compute-complete cycle with no separate Node worker needed for the
-- computation itself (process_pending_merchant_discovery_projection_jobs
-- below is still invoked by a thin cron route, same convention as every
-- other internal worker in this codebase).
CREATE OR REPLACE FUNCTION recompute_merchant_discovery_snapshot(p_partner_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window_start timestamptz := now() - interval '90 days';
  v_window_end   timestamptz := now();
  v_merchant_ok  boolean;
  v_cover_photo  uuid;
  v_suppression  text := NULL;
  v_unique_count integer := 0;
  v_respondents  integer := 0;
  v_band         text := NULL;
  v_labels       jsonb := '[]'::jsonb;
  v_items        jsonb := '[]'::jsonb;
BEGIN
  SELECT (pt.type = 'merchant' AND pt.status = 'active' AND ps.directory_status = 'published')
  INTO v_merchant_ok
  FROM partners pt
  JOIN partner_settings ps ON ps.partner_id = pt.id
  WHERE pt.id = p_partner_id;

  IF v_merchant_ok IS NOT TRUE THEN
    v_suppression := 'merchant_not_published';
  END IF;

  -- Ranking V1 step 1: "at least one currently eligible approved customer
  -- photo" — independent of the 90-day contributor window below.
  SELECT photo_id INTO v_cover_photo
  FROM eligible_public_merchant_visit_photos(p_partner_id)
  ORDER BY approved_at DESC
  LIMIT 1;

  IF v_cover_photo IS NULL AND v_suppression IS NULL THEN
    v_suppression := 'no_eligible_photo';
  END IF;

  -- Ranking V1 step 2: unique active positive contributors in the 90-day
  -- window, same-member/day dedup already folded into dedup_key by the
  -- canonical eligible_public_merchant_visits projection (090).
  SELECT COUNT(DISTINCT dedup_key) INTO v_unique_count
  FROM eligible_public_merchant_visits(p_partner_id) v
  WHERE v.submitted_at BETWEEN v_window_start AND v_window_end;

  SELECT COUNT(DISTINCT dedup_key) INTO v_respondents
  FROM eligible_public_merchant_visits(p_partner_id) v
  WHERE v.submitted_at BETWEEN v_window_start AND v_window_end
    AND array_length(v.experience_option_ids, 1) > 0;

  v_band := CASE WHEN v_unique_count < 5 THEN 'new' ELSE v_unique_count::text END;

  -- §4.3 thresholds: >=5 unique contributors and >=20% of tag respondents.
  SELECT COALESCE(jsonb_agg(ranked.public_label ORDER BY ranked.contributors DESC, ranked.public_label ASC), '[]'::jsonb)
  INTO v_labels
  FROM (
    SELECT tagged.public_label, COUNT(DISTINCT tagged.dedup_key) AS contributors
    FROM (
      SELECT v.dedup_key, opt ->> 'publicLabel' AS public_label
      FROM eligible_public_merchant_visits(p_partner_id) v,
        LATERAL jsonb_array_elements(COALESCE(v.template_snapshot -> 'experience_options', '[]'::jsonb)) AS opt
      WHERE v.submitted_at BETWEEN v_window_start AND v_window_end
        AND (opt ->> 'id') = ANY (v.experience_option_ids)
        AND opt ->> 'publicLabel' IS NOT NULL
    ) tagged
    GROUP BY tagged.public_label
    HAVING COUNT(DISTINCT tagged.dedup_key) >= 5
       AND COUNT(DISTINCT tagged.dedup_key)::numeric / GREATEST(v_respondents, 1) >= 0.2
    ORDER BY COUNT(DISTINCT tagged.dedup_key) DESC, tagged.public_label ASC
    LIMIT 3
  ) ranked;

  -- Parent spec's customer-favourite threshold: >=5 unique contributors.
  SELECT COALESCE(jsonb_agg(ranked.canonical_name ORDER BY ranked.contributors DESC, ranked.canonical_name ASC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT i.canonical_name, COUNT(DISTINCT v.dedup_key) AS contributors
    FROM eligible_public_merchant_visits(p_partner_id) v
    JOIN merchant_discovery_contribution_items ci ON ci.contribution_id = v.contribution_id AND ci.is_recommended = true
    JOIN merchant_discovery_item_mentions m ON m.id = ci.item_mention_id AND m.moderation_status = 'accepted'
    JOIN merchant_discovery_items i ON i.id = m.canonical_item_id AND i.status = 'qualified'
    WHERE v.submitted_at BETWEEN v_window_start AND v_window_end
    GROUP BY i.canonical_name
    HAVING COUNT(DISTINCT v.dedup_key) >= 5
    ORDER BY COUNT(DISTINCT v.dedup_key) DESC, i.canonical_name ASC
    LIMIT 2
  ) ranked;

  IF v_cover_photo IS NULL THEN
    v_labels := '[]'::jsonb;
    v_items := '[]'::jsonb;
    v_unique_count := 0;
    v_band := NULL;
  END IF;

  INSERT INTO merchant_discovery_public_snapshots (
    partner_id, ranking_version, active_positive_unique_count, public_count_band,
    qualified_experience_labels, qualified_recommended_items, cover_photo_id, rank_score,
    source_window_start, source_window_end, generated_at, source_watermark, suppression_reason
  ) VALUES (
    p_partner_id, 1, v_unique_count, v_band,
    v_labels, v_items, v_cover_photo, v_unique_count,
    v_window_start, v_window_end, now(), NULL, v_suppression
  )
  ON CONFLICT (partner_id) DO UPDATE SET
    ranking_version = EXCLUDED.ranking_version,
    active_positive_unique_count = EXCLUDED.active_positive_unique_count,
    public_count_band = EXCLUDED.public_count_band,
    qualified_experience_labels = EXCLUDED.qualified_experience_labels,
    qualified_recommended_items = EXCLUDED.qualified_recommended_items,
    cover_photo_id = EXCLUDED.cover_photo_id,
    rank_score = EXCLUDED.rank_score,
    source_window_start = EXCLUDED.source_window_start,
    source_window_end = EXCLUDED.source_window_end,
    generated_at = EXCLUDED.generated_at,
    suppression_reason = EXCLUDED.suppression_reason;
END;
$$;

REVOKE ALL ON FUNCTION recompute_merchant_discovery_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_merchant_discovery_snapshot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION process_pending_merchant_discovery_projection_jobs(p_limit integer DEFAULT 25)
RETURNS TABLE(claimed integer, succeeded integer, failed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job       merchant_discovery_projection_jobs;
  v_claimed   integer := 0;
  v_succeeded integer := 0;
  v_failed    integer := 0;
BEGIN
  FOR v_job IN SELECT * FROM claim_merchant_discovery_projection_jobs(p_limit) LOOP
    v_claimed := v_claimed + 1;
    BEGIN
      PERFORM recompute_merchant_discovery_snapshot(v_job.partner_id);
      UPDATE merchant_discovery_projection_jobs SET status = 'done', updated_at = now() WHERE id = v_job.id;
      v_succeeded := v_succeeded + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE merchant_discovery_projection_jobs
      SET status = 'pending',
          reason = SQLERRM,
          next_retry_at = now() + (interval '1 minute' * power(2, LEAST(attempts, 6))),
          updated_at = now()
      WHERE id = v_job.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT v_claimed, v_succeeded, v_failed;
END;
$$;

REVOKE ALL ON FUNCTION process_pending_merchant_discovery_projection_jobs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_pending_merchant_discovery_projection_jobs(integer)
  TO service_role;

-- ── shadow read path (§5.4 final paragraph) ─────────────────────────────
-- Not called by any application code yet (Phase B is compute-only). Exists
-- now so the shadow comparison can run against the same contract the real
-- cutover will use later. The join back to the live eligibility function is
-- the safety barrier: a snapshot generated before a reversal/withdrawal/
-- suppression silently drops out here rather than ever being served,
-- without needing its own staleness check.
CREATE OR REPLACE FUNCTION get_public_merchant_discovery_snapshots(p_limit integer DEFAULT 20)
RETURNS TABLE (
  partner_id                   uuid,
  public_count_band            text,
  qualified_experience_labels  jsonb,
  qualified_recommended_items  jsonb,
  cover_photo_id               uuid,
  cover_photo_thumbnail_key    text,
  cover_photo_display_key      text,
  rank_score                   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.partner_id,
    s.public_count_band,
    s.qualified_experience_labels,
    s.qualified_recommended_items,
    p.photo_id,
    p.thumbnail_key,
    p.display_key,
    s.rank_score
  FROM merchant_discovery_public_snapshots s
  JOIN eligible_public_merchant_visit_photos(s.partner_id) p ON p.photo_id = s.cover_photo_id
  WHERE s.suppression_reason IS NULL
    AND s.cover_photo_id IS NOT NULL
  ORDER BY s.rank_score DESC, p.approved_at DESC, s.partner_id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

REVOKE ALL ON FUNCTION get_public_merchant_discovery_snapshots(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_merchant_discovery_snapshots(integer) TO service_role;

-- ── enqueue triggers (§5.4) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_enqueue_merchant_discovery_projection_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'partners' THEN
    v_partner_id := NEW.id;
  ELSE
    v_partner_id := NEW.partner_id;
  END IF;
  PERFORM enqueue_merchant_discovery_projection_refresh(v_partner_id, TG_TABLE_NAME || '_change');
  RETURN NEW;
END;
$$;

-- Contribution submit, withdrawal or suppression.
DROP TRIGGER IF EXISTS trg_mdc_enqueue_projection ON merchant_discovery_contributions;
CREATE TRIGGER trg_mdc_enqueue_projection
  AFTER INSERT OR UPDATE OF withdrawn_at, suppressed_at, would_recommend
  ON merchant_discovery_contributions
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_merchant_discovery_projection_refresh();

-- Discovery participation-setting changes.
DROP TRIGGER IF EXISTS trg_mds_enqueue_projection ON merchant_discovery_settings;
CREATE TRIGGER trg_mds_enqueue_projection
  AFTER UPDATE ON merchant_discovery_settings
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_merchant_discovery_projection_refresh();

-- Merchant publish/unpublish (directory_status). partner_settings and
-- partners are Akiba-Platform-owned tables synced into this database, not
-- written by this repo — the trigger fires regardless of which process
-- performs the UPDATE, which is the point: a projection refresh must
-- follow any publish/suspend transition, not just ones this codebase made.
DROP TRIGGER IF EXISTS trg_ps_enqueue_projection ON partner_settings;
CREATE TRIGGER trg_ps_enqueue_projection
  AFTER UPDATE OF directory_status ON partner_settings
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_merchant_discovery_projection_refresh();

-- Merchant suspend/deactivate (status).
DROP TRIGGER IF EXISTS trg_p_enqueue_projection ON partners;
CREATE TRIGGER trg_p_enqueue_projection
  AFTER UPDATE OF status ON partners
  FOR EACH ROW EXECUTE FUNCTION trg_enqueue_merchant_discovery_projection_refresh();

-- ── enqueue from existing transition RPCs ───────────────────────────────
-- Earning-event reversal, dispute or reinstatement (083). Same signature as
-- before — CREATE OR REPLACE in place, no DROP needed.
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

  PERFORM enqueue_merchant_discovery_projection_refresh(v_row.partner_id, 'earning_status_change');

  RETURN QUERY SELECT true, true, v_from_status, p_to_status;
END;
$$;

REVOKE ALL ON FUNCTION apply_verified_earning_status_change(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_verified_earning_status_change(text, uuid, text, text, text)
  TO service_role;

-- Photo moderation approve/reject (090). Same 5-argument signature.
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

  INSERT INTO discovery_moderation_audit_events (
    photo_id, actor_id, action, reason_code, before_status, after_status, request_correlation_id
  ) VALUES (
    p_photo_id, p_actor_id, p_action, p_reason_code, v_before_status, v_row.moderation_status, p_correlation_id
  );

  PERFORM enqueue_merchant_discovery_projection_refresh(v_row.partner_id, 'photo_moderation');

  RETURN QUERY SELECT true, to_jsonb(v_row), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION perform_visit_photo_transition(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION perform_visit_photo_transition(uuid, text, text, text, text)
  TO service_role;

-- Canonical item qualify/suppress/merge (081). Same 3-argument signature.
CREATE OR REPLACE FUNCTION perform_discovery_item_transition(
  p_item_id            uuid,
  p_action             text,
  p_merge_into_item_id uuid DEFAULT NULL
) RETURNS TABLE(ok boolean, item jsonb, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row merchant_discovery_items;
BEGIN
  SELECT * INTO v_row FROM merchant_discovery_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;

  IF v_row.status IN ('merged', 'suppressed') THEN
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_transition'::text;
    RETURN;
  END IF;

  IF p_action = 'qualify' THEN
    UPDATE merchant_discovery_items
    SET status = 'qualified', qualified_at = COALESCE(qualified_at, now())
    WHERE id = p_item_id
    RETURNING * INTO v_row;
  ELSIF p_action = 'suppress' THEN
    UPDATE merchant_discovery_items
    SET status = 'suppressed'
    WHERE id = p_item_id
    RETURNING * INTO v_row;
  ELSIF p_action = 'merge_into' THEN
    IF p_merge_into_item_id IS NULL OR p_merge_into_item_id = p_item_id THEN
      RETURN QUERY SELECT false, NULL::jsonb, 'invalid_merge_target'::text;
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM merchant_discovery_items
      WHERE id = p_merge_into_item_id AND partner_id = v_row.partner_id
    ) THEN
      RETURN QUERY SELECT false, NULL::jsonb, 'merge_target_not_found'::text;
      RETURN;
    END IF;

    UPDATE merchant_discovery_items
    SET status = 'merged', merged_into_item_id = p_merge_into_item_id
    WHERE id = p_item_id
    RETURNING * INTO v_row;

    UPDATE merchant_discovery_item_mentions
    SET canonical_item_id = p_merge_into_item_id
    WHERE canonical_item_id = p_item_id;

    PERFORM qualify_discovery_item_if_eligible(p_merge_into_item_id);
  ELSE
    RETURN QUERY SELECT false, NULL::jsonb, 'invalid_action'::text;
    RETURN;
  END IF;

  PERFORM enqueue_merchant_discovery_projection_refresh(v_row.partner_id, 'item_transition');

  RETURN QUERY SELECT true, to_jsonb(v_row), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION perform_discovery_item_transition(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION perform_discovery_item_transition(uuid, text, uuid)
  TO service_role;

-- record_discovery_item_mention (081). Same 6-argument signature.
CREATE OR REPLACE FUNCTION record_discovery_item_mention(
  p_request_id      uuid,
  p_client_item_key text,
  p_hub_user_id     uuid,
  p_partner_id      uuid,
  p_raw_label       text,
  p_source          text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_label      text;
  v_normalized text;
  v_item_id    uuid;
  v_status     text;
  v_mention_id uuid;
BEGIN
  v_label := trim(substring(p_raw_label FROM 1 FOR 80));
  IF v_label = '' THEN
    RAISE EXCEPTION 'empty_item_label' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('event_confirmation', 'customer_input', 'existing_selection') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;

  v_item_id := normalize_discovery_item_label(p_partner_id, v_label);
  SELECT normalized_key INTO v_normalized FROM merchant_discovery_items WHERE id = v_item_id;

  v_status := CASE
    WHEN v_label ~* '(https?://|www\.|@[a-z0-9_]{2,}|\+?\d[\d \-]{7,}\d|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})'
      THEN 'flagged'
    ELSE 'accepted'
  END;

  INSERT INTO merchant_discovery_item_mentions (
    request_id, client_item_key, hub_user_id, partner_id,
    raw_label, normalized_label, canonical_item_id, source, moderation_status
  ) VALUES (
    p_request_id, p_client_item_key, p_hub_user_id, p_partner_id,
    v_label, v_normalized, v_item_id, p_source, v_status
  )
  ON CONFLICT (request_id, client_item_key) DO UPDATE
    SET raw_label = EXCLUDED.raw_label,
        normalized_label = EXCLUDED.normalized_label,
        canonical_item_id = EXCLUDED.canonical_item_id,
        source = EXCLUDED.source,
        moderation_status = EXCLUDED.moderation_status,
        updated_at = now()
  RETURNING id INTO v_mention_id;

  IF v_status = 'accepted' THEN
    PERFORM qualify_discovery_item_if_eligible(v_item_id);
    PERFORM enqueue_merchant_discovery_projection_refresh(p_partner_id, 'item_mention');
  END IF;

  RETURN v_mention_id;
END;
$$;

REVOKE ALL ON FUNCTION record_discovery_item_mention(uuid, text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_discovery_item_mention(uuid, text, uuid, uuid, text, text)
  TO service_role;

-- ── backfill (§10.1 item 5) ──────────────────────────────────────────────
-- Enqueue a refresh for every currently-published pilot merchant so the
-- first scheduled worker run populates real snapshots immediately, rather
-- than waiting for the next organic event per merchant.
INSERT INTO merchant_discovery_projection_jobs (partner_id, reason)
SELECT partner_id, 'hardening_091_backfill'
FROM merchant_discovery_settings
WHERE contributions_enabled = true
ON CONFLICT (partner_id) WHERE status = 'pending' DO NOTHING;
