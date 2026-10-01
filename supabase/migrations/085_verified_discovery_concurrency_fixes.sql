-- Two concurrency/idempotency fixes found in review of 084:
--
-- 1. submit_discovery_contribution's idempotency check compared only the
--    key, not the payload. If a client's first response was lost, then the
--    member edited an answer and resubmitted from the same mount (same
--    key, by design — see VisitCardFlow.tsx's idempotencyKeyRef), the
--    second call matched the stored key and returned the earlier success
--    without persisting anything, silently discarding the edit.
-- 2. create_discovery_contribution_request's expire/check/insert sequence
--    had no lock and no DB constraint backing "one open request per
--    member/merchant" — two earning events for the same member/merchant
--    processed concurrently could both pass the "no open request exists"
--    check before either had committed its INSERT, creating two.

-- ── 1: payload-hash-checked idempotency ──────────────────────────────────
ALTER TABLE merchant_discovery_contributions
  ADD COLUMN IF NOT EXISTS last_idempotency_payload_hash text;

CREATE OR REPLACE FUNCTION submit_discovery_contribution(
  p_request_id             uuid,
  p_hub_user_id            uuid,
  p_would_recommend        boolean,
  p_negative_reason_id     text,
  p_party_size             smallint,
  p_party_size_is_six_plus boolean,
  p_experience_option_ids  text[],
  p_items                  jsonb, -- [{clientItemKey, rawLabel, source, isRecommended}, ...]
  p_idempotency_key        text DEFAULT NULL
) RETURNS TABLE(ok boolean, contribution_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request                   discovery_contribution_requests;
  v_existing_contribution_id  uuid;
  v_existing_idem_key         text;
  v_existing_idem_hash        text;
  v_payload_hash              text;
  v_allowed_experience_ids    text[];
  v_item                      jsonb;
  v_item_count                integer;
  v_recommended_count         integer;
  v_contribution_id           uuid;
  v_mention_id                uuid;
  v_sorted_experience_ids     text;
BEGIN
  SELECT * INTO v_request FROM discovery_contribution_requests
  WHERE id = p_request_id AND hub_user_id = p_hub_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Order-independent so reordering the same set of tags between calls
  -- (which shouldn't happen from the client, but shouldn't matter either)
  -- doesn't look like a payload change.
  SELECT string_agg(x, ',' ORDER BY x) INTO v_sorted_experience_ids
  FROM unnest(COALESCE(p_experience_option_ids, ARRAY[]::text[])) AS x;

  v_payload_hash := md5(
    COALESCE(p_would_recommend::text, '') || '|' ||
    COALESCE(p_negative_reason_id, '') || '|' ||
    COALESCE(p_party_size::text, '') || '|' ||
    p_party_size_is_six_plus::text || '|' ||
    COALESCE(v_sorted_experience_ids, '') || '|' ||
    COALESCE(p_items::text, '')
  );

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, last_idempotency_key, last_idempotency_payload_hash
      INTO v_existing_contribution_id, v_existing_idem_key, v_existing_idem_hash
    FROM merchant_discovery_contributions WHERE request_id = p_request_id;

    IF v_existing_contribution_id IS NOT NULL AND v_existing_idem_key = p_idempotency_key THEN
      IF v_existing_idem_hash = v_payload_hash THEN
        -- A genuine retry of the exact same submission — succeed without
        -- reprocessing or bumping answer_version again.
        RETURN QUERY SELECT true, v_existing_contribution_id;
        RETURN;
      ELSE
        -- Same key, different content: a client bug (key not regenerated
        -- after an edit) rather than a safe-to-ignore retry. Reusing the
        -- key here must not silently discard the new answers, so refuse
        -- instead of guessing which version is right.
        RAISE EXCEPTION 'idempotency_key_reused_with_different_payload' USING ERRCODE = '23514';
      END IF;
    END IF;
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
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_request.template_snapshot->'negative_reason_options', '[]'::jsonb)) AS opt
    WHERE opt->>'id' = p_negative_reason_id
  ) THEN
    RAISE EXCEPTION 'invalid_negative_reason' USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(opt->>'id') INTO v_allowed_experience_ids
  FROM jsonb_array_elements(COALESCE(v_request.template_snapshot->'experience_options', '[]'::jsonb)) AS opt;

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
    party_size, party_size_is_six_plus, experience_option_ids,
    last_idempotency_key, last_idempotency_payload_hash
  ) VALUES (
    p_request_id, p_hub_user_id, v_request.partner_id,
    p_would_recommend, p_negative_reason_id,
    p_party_size, p_party_size_is_six_plus, COALESCE(p_experience_option_ids, '{}'),
    p_idempotency_key, v_payload_hash
  )
  ON CONFLICT (request_id) DO UPDATE SET
    would_recommend = EXCLUDED.would_recommend,
    negative_reason_id = EXCLUDED.negative_reason_id,
    party_size = EXCLUDED.party_size,
    party_size_is_six_plus = EXCLUDED.party_size_is_six_plus,
    experience_option_ids = EXCLUDED.experience_option_ids,
    last_idempotency_key = EXCLUDED.last_idempotency_key,
    last_idempotency_payload_hash = EXCLUDED.last_idempotency_payload_hash,
    answer_version = merchant_discovery_contributions.answer_version + 1,
    withdrawn_at = NULL,
    updated_at = now()
  RETURNING id INTO v_contribution_id;

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

-- ── 2: enforce "one open request" as a real constraint ──────────────────
-- A partial unique index is the actual guarantee — the prior expire/check/
-- insert sequence was a check-then-act race under concurrent calls for the
-- same member/merchant. Any concurrent attempt that would violate it now
-- fails at INSERT with a catchable unique_violation instead of silently
-- succeeding twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_contribution_requests_open_per_member_merchant
  ON discovery_contribution_requests (hub_user_id, partner_id)
  WHERE state = 'open';

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
  v_earning_event     verified_earning_events;
BEGIN
  SELECT id INTO v_request_id FROM discovery_contribution_requests
  WHERE earning_event_id = p_earning_event_id;
  IF v_request_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_request_id, 'already_exists'::text;
    RETURN;
  END IF;

  SELECT * INTO v_earning_event FROM verified_earning_events WHERE id = p_earning_event_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_not_found'::text;
    RETURN;
  END IF;
  IF v_earning_event.hub_user_id <> p_hub_user_id OR v_earning_event.partner_id <> p_partner_id THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_mismatch'::text;
    RETURN;
  END IF;
  IF v_earning_event.verification_status <> 'active' THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_not_active'::text;
    RETURN;
  END IF;
  IF v_earning_event.channel <> 'in_store' THEN
    RETURN QUERY SELECT false, NULL::uuid, 'earning_event_not_in_store'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM merchant_discovery_settings
    WHERE partner_id = p_partner_id AND contributions_enabled
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'contributions_not_enabled'::text;
    RETURN;
  END IF;

  UPDATE discovery_contribution_requests
  SET state = 'expired'
  WHERE hub_user_id = p_hub_user_id AND partner_id = p_partner_id
    AND state = 'open' AND expires_at < now();

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

  v_occurred_at := v_earning_event.occurred_at;

  SELECT id, version, to_jsonb(t) INTO v_template_id, v_template_version, v_template_snapshot
  FROM discovery_question_templates t
  WHERE category_slug IS NULL AND active
  ORDER BY version DESC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'no_active_template'::text;
    RETURN;
  END IF;

  BEGIN
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
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race to a concurrent call for the same member/merchant —
    -- that one is now the open request; this one correctly steps back
    -- rather than erroring the caller.
    RETURN QUERY SELECT false, NULL::uuid, 'open_request_exists'::text;
    RETURN;
  END;

  RETURN QUERY SELECT true, v_request_id, 'created'::text;
END;
$$;
