-- ─────────────────────────────────────────────────────────────────────────────
-- polls_atomic_submit.sql
-- Atomic poll submission RPC.
--
-- Wraps poll_responses insert + poll_response_answers inserts + mint job insert
-- in a single transaction. If any step fails the whole block rolls back, so a
-- user can never be left in a state where their response row exists but their
-- reward was not queued (the permanent lock-out bug).
--
-- Usage (from server-side API, using service role):
--   SELECT * FROM submit_poll_response(
--     p_poll_id        := '<uuid>',
--     p_wallet         := '0xabc…',   -- already lowercased by the caller
--     p_reward_points  := 50,
--     p_answers        := '[{"question_id":"…","selected_option_id":"…","text_answer":null},…]',
--     p_idempotency_key := 'poll-completion:<poll_id>:<wallet_lc>',
--     p_poll_slug      := 'akiba-verified-insights-v1',
--     p_accepted_terms := true,
--     p_terms_version  := 'akiba-verified-insights-v1'
--   );
--
-- Returns one row:
--   ok            bool    — true on success; false if already submitted
--   code          text    — 'ok' | 'already'
--   response_id   uuid    — the new poll_responses.id (null when already)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE poll_responses
  ADD COLUMN IF NOT EXISTS accepted_terms bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz;

DROP FUNCTION IF EXISTS submit_poll_response(uuid, text, int, jsonb, text, text);

CREATE OR REPLACE FUNCTION submit_poll_response(
  p_poll_id         uuid,
  p_wallet          text,   -- lowercase
  p_reward_points   int,
  p_answers         jsonb,  -- array of {question_id, selected_option_id, text_answer}
  p_idempotency_key text,
  p_poll_slug       text,
  p_accepted_terms  bool,
  p_terms_version   text
)
RETURNS TABLE (
  ok           bool,
  code         text,
  response_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as owner (superuser/service), bypasses RLS
SET search_path = public
AS $$
DECLARE
  v_response_id  uuid;
  v_answer       jsonb;
BEGIN
  IF p_accepted_terms IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Poll terms must be accepted before submitting'
      USING ERRCODE = '22023';
  END IF;

  -- ── 1. Insert poll_responses (unique on poll_id, wallet_address) ──────────
  INSERT INTO poll_responses (
    poll_id,
    wallet_address,
    reward_queued,
    reward_points_awarded,
    accepted_terms,
    terms_version,
    accepted_terms_at
  )
  VALUES (
    p_poll_id,
    p_wallet,
    (p_reward_points > 0),   -- pre-mark as queued; mint job follows below
    p_reward_points,
    true,
    p_terms_version,
    now()
  )
  ON CONFLICT (poll_id, wallet_address) DO NOTHING
  RETURNING id INTO v_response_id;

  -- Duplicate submission — idempotent success
  IF v_response_id IS NULL THEN
    RETURN QUERY SELECT false, 'already'::text, NULL::uuid;
    RETURN;
  END IF;

  -- ── 2. Insert poll_response_answers ──────────────────────────────────────
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    INSERT INTO poll_response_answers (
      response_id,
      question_id,
      selected_option_id,
      text_answer
    )
    VALUES (
      v_response_id,
      (v_answer->>'question_id')::uuid,
      CASE WHEN (v_answer->>'selected_option_id') IS NOT NULL
           THEN (v_answer->>'selected_option_id')::uuid
           ELSE NULL END,
      v_answer->>'text_answer'
    );
  END LOOP;

  -- ── 3. Queue reward mint job (only when reward_points > 0) ───────────────
  IF p_reward_points > 0 THEN
    INSERT INTO minipoint_mint_jobs (
      idempotency_key,
      user_address,
      points,
      reason,
      status,
      payload
    )
    VALUES (
      p_idempotency_key,
      p_wallet,
      p_reward_points,
      'poll-completion:' || p_poll_slug,
      'pending',
      jsonb_build_object(
        'kind',          'poll_completion',
        'userAddress',   p_wallet,
        'pollId',        p_poll_id::text,
        'pollSlug',      p_poll_slug,
        'pointsAwarded', p_reward_points,
        'submittedAt',   to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    -- If key already exists (retry after partial failure) the job row is
    -- already there — this is safe; the worker will pick it up.
  END IF;

  RETURN QUERY SELECT true, 'ok'::text, v_response_id;
END;
$$;

-- Grant execute to service_role only (anon/authenticated cannot call this)
REVOKE ALL ON FUNCTION submit_poll_response(uuid, text, int, jsonb, text, text, bool, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_poll_response(uuid, text, int, jsonb, text, text, bool, text) TO service_role;
