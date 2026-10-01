-- Verified Discovery and Merchant Acquisition V1 — Stage 0 + Stage 1 core
-- schema (packages/hub-page/docs/verified-discovery-acquisition-v1-spec.md
-- §10). This migration adds only the private, pilot-scope tables needed for
-- Stage 0 (earning-event ingestion) and Stage 1 (the closed structured-data
-- pilot / visit-card contribution flow). No public snapshot tables (§10.9)
-- are created here — those are Stage 3, once Data/Privacy have reviewed
-- thresholds per §21; nothing in this migration is ever read by an
-- unauthenticated or public-facing query. Stage 2 (first-party photos) is
-- 082_verified_discovery_photos.sql.
--
-- merchant_discovery_settings is a Hub-side SYNCED READ MODEL only — the
-- canonical settings are owned and mutated by Akiba-Platform (§10.1, §11.4),
-- a separate codebase, not this repo. All flags default false so nothing
-- activates for a merchant until Akiba-Platform starts writing to this
-- table via an authenticated internal contract (not yet built — §21.4).
--
-- discovery_question_templates seeds exactly one general-fallback row using
-- the spec's own §8.3 example copy. This is DRAFT placeholder wording, not
-- final — §9.2 makes Product/Research the accountable owner of real copy.
-- It exists so the pilot flow is runnable now instead of blocked on that
-- sign-off; swap the row's content (as a new version) once real copy lands.

-- ── discovery_question_templates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discovery_question_templates (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version                     integer NOT NULL DEFAULT 1,
  category_slug               text, -- null = general fallback
  recommendation_prompt       text NOT NULL,
  negative_reason_options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  party_size_prompt           text NOT NULL,
  item_prompt                 text NOT NULL,
  recommendation_item_prompt  text NOT NULL,
  experience_prompt           text,
  experience_options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_purchased_items         integer NOT NULL DEFAULT 4,
  max_recommended_items       integer NOT NULL DEFAULT 3,
  max_experience_options      integer NOT NULL DEFAULT 3,
  photo_prompt                text NOT NULL,
  photo_safety_guidance       text NOT NULL,
  active                      boolean NOT NULL DEFAULT true,
  starts_at                   timestamptz,
  ends_at                     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- COALESCE so the single general-fallback (category_slug IS NULL) row is
-- still protected from accidental duplication — a bare UNIQUE(category_slug,
-- version) wouldn't catch that, since NULL <> NULL in a unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_question_templates_category_version
  ON discovery_question_templates (COALESCE(category_slug, ''), version);

DROP TRIGGER IF EXISTS trg_discovery_question_templates_touch ON discovery_question_templates;
CREATE TRIGGER trg_discovery_question_templates_touch
  BEFORE UPDATE ON discovery_question_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE discovery_question_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discovery_question_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON discovery_question_templates TO service_role;

INSERT INTO discovery_question_templates (
  category_slug, version, recommendation_prompt, negative_reason_options,
  party_size_prompt, item_prompt, recommendation_item_prompt,
  experience_prompt, experience_options,
  photo_prompt, photo_safety_guidance
)
SELECT
  NULL, 1,
  'Would you send a friend to {{merchantName}}?',
  '[
    {"id":"product_quality","label":"Product quality"},
    {"id":"service","label":"Service"},
    {"id":"value","label":"Value"},
    {"id":"availability","label":"Availability"},
    {"id":"convenience","label":"Convenience"},
    {"id":"other","label":"Something else"}
  ]'::jsonb,
  'Who did this purchase cover?',
  'What did you get?',
  'Which would you tell someone to try?',
  'What is {{merchantName}} great for?',
  '[
    {"id":"working","inputLabel":"Working or co-working","publicLabel":"Great for working"},
    {"id":"friendly_staff","inputLabel":"Friendly staff","publicLabel":"Friendly staff"},
    {"id":"meeting_friends","inputLabel":"Meeting friends","publicLabel":"Good for meeting friends"},
    {"id":"good_wifi","inputLabel":"Good Wi-Fi","publicLabel":"Good Wi-Fi"},
    {"id":"quick_stop","inputLabel":"Quick stop","publicLabel":"Great for a quick stop"},
    {"id":"relaxed","inputLabel":"Relaxed atmosphere","publicLabel":"Relaxed atmosphere"}
  ]'::jsonb,
  'Add a photo to help people picture the place.',
  'Avoid faces, children, receipts and personal information.'
WHERE NOT EXISTS (
  SELECT 1 FROM discovery_question_templates WHERE category_slug IS NULL AND version = 1
);

-- ── merchant_discovery_settings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_discovery_settings (
  partner_id                uuid PRIMARY KEY REFERENCES partners(id),
  contributions_enabled     boolean NOT NULL DEFAULT false,
  structured_proof_enabled  boolean NOT NULL DEFAULT false,
  customer_photos_enabled   boolean NOT NULL DEFAULT false,
  social_showcase_enabled   boolean NOT NULL DEFAULT false,
  primary_action_kind       text,
  primary_action_url        text,
  updated_by                text,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE merchant_discovery_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_settings TO service_role;

-- ── merchant_discovery_items (§10.2) ────────────────────────────────────
-- Populated only by the customer-generated normalization pipeline below —
-- never by merchant product setup (§9.3, §7.8: "A merchant is not required
-- to create or maintain products for this feature").
CREATE TABLE IF NOT EXISTS merchant_discovery_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id),
  canonical_name      text NOT NULL CHECK (char_length(canonical_name) BETWEEN 1 AND 120),
  normalized_key      text NOT NULL,
  category            text,
  aliases             text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'candidate'
                         CHECK (status IN ('candidate', 'qualified', 'merged', 'suppressed')),
  merged_into_item_id uuid REFERENCES merchant_discovery_items(id),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  qualified_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_discovery_items_partner_key
  ON merchant_discovery_items (partner_id, normalized_key);
CREATE INDEX IF NOT EXISTS idx_merchant_discovery_items_status
  ON merchant_discovery_items (partner_id, status);

DROP TRIGGER IF EXISTS trg_merchant_discovery_items_touch ON merchant_discovery_items;
CREATE TRIGGER trg_merchant_discovery_items_touch
  BEFORE UPDATE ON merchant_discovery_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE merchant_discovery_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_items TO service_role;

-- ── verified_earning_events (§10.4) ─────────────────────────────────────
-- Append-oriented evidence. `channel` decides whether an event is eligible
-- to create a visit-card contribution request (§8.1: only `in_store`
-- qualifies) — it is resolved server-side by the ingestion callers below,
-- never trusted verbatim from an inbound request body for `merchant_scan`.
CREATE TABLE IF NOT EXISTS verified_earning_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               text NOT NULL UNIQUE,
  hub_user_id            uuid NOT NULL,
  canonical_id           text,
  partner_id             uuid NOT NULL REFERENCES partners(id),
  source                 text NOT NULL CHECK (source IN ('merchant_scan', 'merchant_purchase')),
  channel                text NOT NULL DEFAULT 'unknown'
                            CHECK (channel IN ('in_store', 'online', 'unknown')),
  occurred_at             timestamptz NOT NULL,
  purchase_event_id       text,
  branch_id               uuid,
  paid_amount_minor       bigint,
  currency                char(3),
  gross_amount_minor      bigint,
  source_item_ref         text,
  item_name_snapshot      text,
  item_category_snapshot  text,
  verification_status     text NOT NULL DEFAULT 'active'
                             CHECK (verification_status IN ('active', 'reversed', 'disputed')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verified_earning_events_member_partner
  ON verified_earning_events (hub_user_id, partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_verified_earning_events_partner_status
  ON verified_earning_events (partner_id, verification_status);

DROP TRIGGER IF EXISTS trg_verified_earning_events_touch ON verified_earning_events;
CREATE TRIGGER trg_verified_earning_events_touch
  BEFORE UPDATE ON verified_earning_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE verified_earning_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON verified_earning_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON verified_earning_events TO service_role;

-- ── discovery_contribution_requests (§10.5) ─────────────────────────────
CREATE TABLE IF NOT EXISTS discovery_contribution_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_event_id    uuid NOT NULL UNIQUE REFERENCES verified_earning_events(id),
  hub_user_id         uuid NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partners(id),
  template_id         uuid NOT NULL REFERENCES discovery_question_templates(id),
  template_version    integer NOT NULL,
  template_snapshot   jsonb NOT NULL,
  state               text NOT NULL DEFAULT 'open'
                         CHECK (state IN ('open', 'submitted', 'dismissed', 'expired', 'ineligible')),
  expires_at           timestamptz NOT NULL,
  first_prompted_at    timestamptz,
  submitted_at         timestamptz,
  dismissed_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_contribution_requests_member_state
  ON discovery_contribution_requests (hub_user_id, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_discovery_contribution_requests_member_partner
  ON discovery_contribution_requests (hub_user_id, partner_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_discovery_contribution_requests_touch ON discovery_contribution_requests;
CREATE TRIGGER trg_discovery_contribution_requests_touch
  BEFORE UPDATE ON discovery_contribution_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE discovery_contribution_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discovery_contribution_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON discovery_contribution_requests TO service_role;

-- ── merchant_discovery_contributions (§10.6) ────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_discovery_contributions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               uuid NOT NULL UNIQUE REFERENCES discovery_contribution_requests(id),
  hub_user_id              uuid NOT NULL,
  partner_id               uuid NOT NULL REFERENCES partners(id),
  would_recommend          boolean,
  negative_reason_id       text,
  party_size               smallint CHECK (party_size BETWEEN 1 AND 5),
  party_size_is_six_plus   boolean NOT NULL DEFAULT false,
  experience_option_ids    text[] NOT NULL DEFAULT '{}',
  answer_version           integer NOT NULL DEFAULT 1,
  submitted_at              timestamptz NOT NULL DEFAULT now(),
  withdrawn_at              timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (party_size IS NOT NULL AND party_size_is_six_plus))
);

DROP TRIGGER IF EXISTS trg_merchant_discovery_contributions_touch ON merchant_discovery_contributions;
CREATE TRIGGER trg_merchant_discovery_contributions_touch
  BEFORE UPDATE ON merchant_discovery_contributions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE merchant_discovery_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_contributions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_contributions TO service_role;

-- ── merchant_discovery_item_mentions (§10.3) ────────────────────────────
-- Raw labels are private contribution data (§13.1). Only an accepted
-- canonical item that independently qualifies (see
-- qualify_discovery_item_if_eligible below) may ever become public.
CREATE TABLE IF NOT EXISTS merchant_discovery_item_mentions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid NOT NULL REFERENCES discovery_contribution_requests(id),
  client_item_key     text NOT NULL,
  hub_user_id         uuid NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partners(id),
  raw_label           text NOT NULL CHECK (char_length(raw_label) BETWEEN 1 AND 80),
  normalized_label    text NOT NULL,
  canonical_item_id   uuid REFERENCES merchant_discovery_items(id),
  source              text NOT NULL
                         CHECK (source IN ('event_confirmation', 'customer_input', 'existing_selection')),
  moderation_status   text NOT NULL DEFAULT 'pending'
                         CHECK (moderation_status IN ('pending', 'accepted', 'flagged', 'suppressed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, client_item_key)
);

CREATE INDEX IF NOT EXISTS idx_discovery_item_mentions_canonical
  ON merchant_discovery_item_mentions (canonical_item_id, moderation_status);

DROP TRIGGER IF EXISTS trg_discovery_item_mentions_touch ON merchant_discovery_item_mentions;
CREATE TRIGGER trg_discovery_item_mentions_touch
  BEFORE UPDATE ON merchant_discovery_item_mentions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE merchant_discovery_item_mentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_item_mentions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_item_mentions TO service_role;

-- ── merchant_discovery_contribution_items (§10.7) ───────────────────────
-- Separates "the customer got it" from "the customer recommends it".
CREATE TABLE IF NOT EXISTS merchant_discovery_contribution_items (
  contribution_id   uuid NOT NULL REFERENCES merchant_discovery_contributions(id),
  item_mention_id   uuid NOT NULL REFERENCES merchant_discovery_item_mentions(id),
  is_recommended    boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, item_mention_id)
);

ALTER TABLE merchant_discovery_contribution_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_discovery_contribution_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON merchant_discovery_contribution_items TO service_role;

-- ── normalize_discovery_item_label (§9.3 steps 4-6) ─────────────────────
-- Resolves a raw customer-typed label to a canonical item id, scoped to one
-- merchant, creating a new `candidate` row when nothing matches. Kept
-- synchronous (no separate worker) — this is cheap, single-partner text
-- normalization, not the aggregate/qualification work.
CREATE OR REPLACE FUNCTION normalize_discovery_item_label(
  p_partner_id uuid,
  p_raw_label  text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key         text;
  v_name        text;
  v_item_id     uuid;
  v_merged_into uuid;
BEGIN
  v_name := trim(substring(p_raw_label FROM 1 FOR 80));
  IF v_name = '' THEN
    RAISE EXCEPTION 'empty_item_label' USING ERRCODE = '22023';
  END IF;

  v_key := regexp_replace(lower(v_name), '[^a-z0-9]+', ' ', 'g');
  v_key := trim(regexp_replace(v_key, '\s+', ' ', 'g'));
  IF v_key = '' THEN
    RAISE EXCEPTION 'unrecognizable_item_label' USING ERRCODE = '22023';
  END IF;

  SELECT id, merged_into_item_id INTO v_item_id, v_merged_into
  FROM merchant_discovery_items
  WHERE partner_id = p_partner_id
    AND (normalized_key = v_key OR v_key = ANY(aliases))
    AND status <> 'suppressed'
  ORDER BY (status = 'merged') ASC, first_seen_at ASC
  LIMIT 1;

  IF v_item_id IS NOT NULL THEN
    IF v_merged_into IS NOT NULL THEN
      RETURN v_merged_into;
    END IF;
    RETURN v_item_id;
  END IF;

  INSERT INTO merchant_discovery_items (partner_id, canonical_name, normalized_key, status, first_seen_at)
  VALUES (p_partner_id, v_name, v_key, 'candidate', now())
  RETURNING id INTO v_item_id;

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION normalize_discovery_item_label(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION normalize_discovery_item_label(uuid, text) TO service_role;

-- ── qualify_discovery_item_if_eligible (§9.3 step 8, §10.10) ────────────
-- Promotes a candidate to `qualified` once 3 unique eligible members have
-- independently named/selected it (accepted mentions only) within 90 days.
CREATE OR REPLACE FUNCTION qualify_discovery_item_if_eligible(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unique_members integer;
BEGIN
  SELECT COUNT(DISTINCT hub_user_id) INTO v_unique_members
  FROM merchant_discovery_item_mentions
  WHERE canonical_item_id = p_item_id
    AND moderation_status = 'accepted'
    AND created_at >= now() - interval '90 days';

  IF v_unique_members >= 3 THEN
    UPDATE merchant_discovery_items
    SET status = 'qualified', qualified_at = COALESCE(qualified_at, now())
    WHERE id = p_item_id AND status = 'candidate';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION qualify_discovery_item_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualify_discovery_item_if_eligible(uuid) TO service_role;

-- ── record_discovery_item_mention ───────────────────────────────────────
-- Single entry point the PUT contribution route calls once per item the
-- member confirms/types: normalizes+resolves the canonical item, runs a
-- conservative policy screen (§9.3: "URLs, handles, contact information and
-- text that does not plausibly name a product or service are rejected or
-- sent to review" — anything matching goes to `flagged` for the admin
-- queue rather than being silently dropped), records the mention
-- idempotently on (request_id, client_item_key), and re-checks
-- qualification when the mention is accepted outright.
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
  END IF;

  RETURN v_mention_id;
END;
$$;

REVOKE ALL ON FUNCTION record_discovery_item_mention(uuid, text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_discovery_item_mention(uuid, text, uuid, uuid, text, text)
  TO service_role;

-- ── create_discovery_contribution_request (§8.2 fatigue policy) ────────
-- Atomic so the app layer never has to race its own fatigue checks against
-- concurrent ingestion calls. Values below (14-day expiry, one open request
-- per merchant/member, 14-day cooldown, 2 prompts/7 days) are the spec's
-- stated defaults — server configuration per §8.2, not client constants;
-- they live here rather than a separate config table for this pass and can
-- be pulled out later without an API shape change.
CREATE OR REPLACE FUNCTION create_discovery_contribution_request(
  p_earning_event_id uuid,
  p_hub_user_id      uuid,
  p_partner_id       uuid
) RETURNS TABLE(ok boolean, request_id uuid, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_template_id       uuid;
  v_template_version  integer;
  v_template_snapshot jsonb;
  v_request_id        uuid;
  v_occurred_at       timestamptz;
BEGIN
  SELECT id INTO v_request_id FROM discovery_contribution_requests
  WHERE earning_event_id = p_earning_event_id;
  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_request_id, 'already_exists'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM discovery_contribution_requests
    WHERE hub_user_id = p_hub_user_id AND partner_id = p_partner_id AND state = 'open'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'open_request_exists'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM discovery_contribution_requests
    WHERE hub_user_id = p_hub_user_id AND partner_id = p_partner_id
      AND created_at >= now() - interval '14 days'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'cooldown_active'::text;
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*) FROM discovery_contribution_requests
    WHERE hub_user_id = p_hub_user_id AND created_at >= now() - interval '7 days'
  ) >= 2 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'fatigue_limit_reached'::text;
    RETURN;
  END IF;

  SELECT occurred_at INTO v_occurred_at FROM verified_earning_events WHERE id = p_earning_event_id;

  SELECT id, version, to_jsonb(t) INTO v_template_id, v_template_version, v_template_snapshot
  FROM discovery_question_templates t
  WHERE category_slug IS NULL AND active
  ORDER BY version DESC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'no_active_template'::text;
    RETURN;
  END IF;

  INSERT INTO discovery_contribution_requests (
    earning_event_id, hub_user_id, partner_id,
    template_id, template_version, template_snapshot,
    state, expires_at
  ) VALUES (
    p_earning_event_id, p_hub_user_id, p_partner_id,
    v_template_id, v_template_version, v_template_snapshot,
    'open', COALESCE(v_occurred_at, now()) + interval '14 days'
  )
  RETURNING id INTO v_request_id;

  RETURN QUERY SELECT true, v_request_id, 'created'::text;
END;
$$;

REVOKE ALL ON FUNCTION create_discovery_contribution_request(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_discovery_contribution_request(uuid, uuid, uuid)
  TO service_role;

-- ── perform_discovery_item_transition (admin moderation queue) ─────────
-- Same atomic-transition-RPC shape as perform_merchant_directory_transition
-- (packages/admin-dashboard directory-reviews feature): guarded state
-- machine, row-locked, returns the updated row or a stable error_code the
-- route maps to HTTP. Audit logging happens app-side via writeAdminAuditLog
-- after a successful call, same as that feature.
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

  RETURN QUERY SELECT true, to_jsonb(v_row), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION perform_discovery_item_transition(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION perform_discovery_item_transition(uuid, text, uuid)
  TO service_role;

-- ── submit_discovery_contribution (PUT /api/me/discovery-contributions/:id) ──
-- Single atomic entry point for the visit-card submit/edit step (§8.3-§8.5):
-- upserts the contribution row (preserving the original submitted_at,
-- bumping answer_version on edit), replaces its item join rows, and routes
-- each item through record_discovery_item_mention. Every rejection is a
-- RAISE EXCEPTION and happens BEFORE any write below — a plain early
-- `RETURN` inside a plpgsql function does NOT roll back statements already
-- executed in that same call, only an actual exception does, so all
-- validation is front-loaded and the write section has no failure exits.
CREATE OR REPLACE FUNCTION submit_discovery_contribution(
  p_request_id             uuid,
  p_hub_user_id            uuid,
  p_would_recommend        boolean,
  p_negative_reason_id     text,
  p_party_size             smallint,
  p_party_size_is_six_plus boolean,
  p_experience_option_ids  text[],
  p_items                  jsonb -- [{clientItemKey, rawLabel, source, isRecommended}, ...]
) RETURNS TABLE(ok boolean, contribution_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request                discovery_contribution_requests;
  v_allowed_experience_ids text[];
  v_item                   jsonb;
  v_item_count             integer;
  v_recommended_count      integer;
  v_contribution_id        uuid;
  v_mention_id             uuid;
BEGIN
  SELECT * INTO v_request FROM discovery_contribution_requests
  WHERE id = p_request_id AND hub_user_id = p_hub_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.expires_at < now() THEN
    IF v_request.state = 'open' THEN
      UPDATE discovery_contribution_requests SET state = 'expired' WHERE id = p_request_id;
    END IF;
    RAISE EXCEPTION 'expired' USING ERRCODE = '55000';
  END IF;

  IF v_request.state NOT IN ('open', 'submitted') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;

  IF p_party_size IS NOT NULL AND p_party_size_is_six_plus THEN
    RAISE EXCEPTION 'invalid_party_size' USING ERRCODE = '23514';
  END IF;

  IF p_negative_reason_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_request.template_snapshot->'negativeReasonOptions', '[]'::jsonb)) AS opt
    WHERE opt->>'id' = p_negative_reason_id
  ) THEN
    RAISE EXCEPTION 'invalid_negative_reason' USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(opt->>'id') INTO v_allowed_experience_ids
  FROM jsonb_array_elements(COALESCE(v_request.template_snapshot->'experienceOptions', '[]'::jsonb)) AS opt;

  IF p_experience_option_ids IS NOT NULL AND array_length(p_experience_option_ids, 1) IS NOT NULL THEN
    IF array_length(p_experience_option_ids, 1) > 3 THEN
      RAISE EXCEPTION 'too_many_experience_options' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(p_experience_option_ids) AS opt_id
      WHERE opt_id <> ALL (COALESCE(v_allowed_experience_ids, ARRAY[]::text[]))
    ) THEN
      RAISE EXCEPTION 'invalid_experience_option' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_item_count := COALESCE(jsonb_array_length(p_items), 0);
  IF v_item_count > 4 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO v_recommended_count
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item
  WHERE COALESCE((item->>'isRecommended')::boolean, false);

  IF v_recommended_count > 3 THEN
    RAISE EXCEPTION 'too_many_recommended_items' USING ERRCODE = '23514';
  END IF;

  INSERT INTO merchant_discovery_contributions (
    request_id, hub_user_id, partner_id,
    would_recommend, negative_reason_id,
    party_size, party_size_is_six_plus, experience_option_ids
  ) VALUES (
    p_request_id, p_hub_user_id, v_request.partner_id,
    p_would_recommend, p_negative_reason_id,
    p_party_size, p_party_size_is_six_plus, COALESCE(p_experience_option_ids, '{}')
  )
  ON CONFLICT (request_id) DO UPDATE SET
    would_recommend = EXCLUDED.would_recommend,
    negative_reason_id = EXCLUDED.negative_reason_id,
    party_size = EXCLUDED.party_size,
    party_size_is_six_plus = EXCLUDED.party_size_is_six_plus,
    experience_option_ids = EXCLUDED.experience_option_ids,
    answer_version = merchant_discovery_contributions.answer_version + 1,
    withdrawn_at = NULL,
    updated_at = now()
  RETURNING id INTO v_contribution_id;

  -- Items can change between edits — the join table is replaced each
  -- submit; mention rows themselves are never deleted (append-oriented
  -- evidence feeding item qualification).
  DELETE FROM merchant_discovery_contribution_items WHERE contribution_id = v_contribution_id;

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_mention_id := record_discovery_item_mention(
        p_request_id,
        v_item->>'clientItemKey',
        p_hub_user_id,
        v_request.partner_id,
        v_item->>'rawLabel',
        COALESCE(v_item->>'source', 'customer_input')
      );

      INSERT INTO merchant_discovery_contribution_items (contribution_id, item_mention_id, is_recommended)
      VALUES (v_contribution_id, v_mention_id, COALESCE((v_item->>'isRecommended')::boolean, false));
    END LOOP;
  END IF;

  UPDATE discovery_contribution_requests
  SET state = 'submitted', submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_request_id;

  RETURN QUERY SELECT true, v_contribution_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_discovery_contribution(uuid, uuid, boolean, text, smallint, boolean, text[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_discovery_contribution(uuid, uuid, boolean, text, smallint, boolean, text[], jsonb)
  TO service_role;
