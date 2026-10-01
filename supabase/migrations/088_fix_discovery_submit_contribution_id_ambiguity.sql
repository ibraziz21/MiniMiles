-- `submit_discovery_contribution` returns a TABLE column named
-- `contribution_id`. In PL/pgSQL that output column is also a function
-- variable, so the unqualified join-table predicate
--
--   WHERE contribution_id = v_contribution_id
--
-- is ambiguous at runtime (SQLSTATE 42702). Reinstall the current 085
-- function with that table column explicitly qualified. All validation,
-- payload-hash idempotency and edit semantics remain unchanged.

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
        RETURN QUERY SELECT true, v_existing_contribution_id;
        RETURN;
      ELSE
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

  DELETE FROM merchant_discovery_contribution_items AS contribution_item
  WHERE contribution_item.contribution_id = v_contribution_id;

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

REVOKE ALL ON FUNCTION submit_discovery_contribution(uuid, uuid, boolean, text, smallint, boolean, text[], jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_discovery_contribution(uuid, uuid, boolean, text, smallint, boolean, text[], jsonb, text)
  TO service_role;
