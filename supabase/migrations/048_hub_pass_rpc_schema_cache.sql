-- 048_hub_pass_rpc_schema_cache.sql
-- Reassert the canonical three-argument pass RPC after the Hub began calling
-- it with every named argument. The explicit PostgREST notification makes the
-- function visible immediately after deployment instead of waiting for a
-- schema-cache refresh.

CREATE OR REPLACE FUNCTION create_or_get_hub_pass(
  p_user_id uuid,
  p_email   text,
  p_src     text DEFAULT 'organic'
) RETURNS TABLE(public_pass_id uuid, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing uuid;
  v_inserted uuid;
BEGIN
  SELECT hup.public_pass_id INTO v_existing
  FROM hub_user_passes hup
  WHERE hup.user_id = p_user_id;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, false;
    RETURN;
  END IF;

  INSERT INTO hub_user_passes (user_id, email, signup_src)
  VALUES (p_user_id, p_email, p_src)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING hub_user_passes.public_pass_id INTO v_inserted;

  IF v_inserted IS NULL THEN
    SELECT hup.public_pass_id INTO v_existing
    FROM hub_user_passes hup
    WHERE hup.user_id = p_user_id;
    RETURN QUERY SELECT v_existing, false;
    RETURN;
  END IF;

  INSERT INTO internal_event_jobs (
    event_type,
    idempotency_key,
    identities,
    metadata
  )
  VALUES (
    'pass_activated',
    'pass:' || p_user_id::text,
    jsonb_build_array(jsonb_build_object('type', 'email', 'value', p_email)),
    jsonb_build_object('src', p_src, 'userId', p_user_id)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY SELECT v_inserted, true;
END;
$$;

REVOKE ALL ON FUNCTION create_or_get_hub_pass(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_or_get_hub_pass(uuid, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
