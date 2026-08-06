-- Walletless Pass skill games — Slice 3 (durable reward delivery).
-- packages/hub-page/docs/walletless-pass-skill-games-spec.md §10.4, §11.
--
-- Mirrors the exact reserve/complete/fail delivery pattern already proven by
-- api_partner_quest_reward_deliveries (migration 054) — same idempotency
-- shape, same ledger-credit-inline-for-offchain / mint-job-pending-for-onchain
-- split, same worker completion/failure RPC pair.

-- ── 1. Reward deliveries (§10.4) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.skill_game_reward_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         text NOT NULL UNIQUE REFERENCES public.skill_game_sessions(session_id),
  canonical_id       uuid NOT NULL,
  mode               text NOT NULL CHECK (mode IN ('offchain_ledger', 'onchain_mint')),
  status             text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  points             integer NOT NULL CHECK (points > 0),
  destination_wallet text,
  idempotency_key    text NOT NULL UNIQUE,
  ledger_entry_id    uuid,
  mint_job_id        uuid,
  external_ref       text,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'onchain_mint' AND destination_wallet IS NOT NULL)
    OR
    (mode = 'offchain_ledger' AND destination_wallet IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_skill_game_reward_deliveries_status
  ON public.skill_game_reward_deliveries (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_skill_game_reward_deliveries_canonical
  ON public.skill_game_reward_deliveries (canonical_id);

ALTER TABLE public.skill_game_reward_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.skill_game_reward_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.skill_game_reward_deliveries TO service_role;

-- Belt-and-suspenders against a concurrent double-credit even if two finish
-- calls somehow both pass the session_id-keyed reservation above (§11.2).
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_game_reward_deliveries_ledger_source
  ON public.skill_game_reward_deliveries (session_id)
  WHERE mode = 'offchain_ledger' AND status = 'completed';

DO $$
BEGIN
  IF to_regclass('public.minipoint_mint_jobs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE minipoint_mint_jobs ADD COLUMN IF NOT EXISTS skill_game_reward_delivery_id uuid';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_minipoint_jobs_skill_game_delivery ON minipoint_mint_jobs (skill_game_reward_delivery_id) WHERE skill_game_reward_delivery_id IS NOT NULL';
  END IF;
END;
$$;

-- ── 2. Atomic finalization RPC (§11.1) ──────────────────────────────────────
--
-- Score/reward/flags are accepted ONLY from this RPC's caller — the Backend
-- service role, never anon/authenticated — and the Backend itself must have
-- already validated the reward against its own score table before calling
-- this. Idempotent: a session already finalized returns its persisted result
-- and delivery state instead of recomputing or re-crediting.
CREATE OR REPLACE FUNCTION public.finalize_hub_skill_game_session(
  p_session_id       text,
  p_canonical_id     uuid,
  p_score            integer,
  p_accepted         boolean,
  p_reward_miles     integer,
  p_reward_stable    numeric,
  p_completed        boolean,
  p_anti_abuse_flags text[]
)
RETURNS TABLE(
  accepted           boolean,
  score              integer,
  reward_miles       integer,
  reward_stable      numeric,
  delivery_id        uuid,
  delivery_mode      text,
  delivery_status    text,
  destination_wallet text,
  already_finalized  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation hub_skill_game_play_reservations%ROWTYPE;
  v_server      skill_game_server_sessions%ROWTYPE;
  v_result      skill_game_sessions%ROWTYPE;
  v_delivery    skill_game_reward_deliveries%ROWTYPE;
  v_wallet      text;
  v_ledger_id   uuid;
  v_game_label  text;
BEGIN
  -- 1. lock the play reservation and server session
  SELECT * INTO v_reservation
  FROM hub_skill_game_play_reservations
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found for session %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_server
  FROM skill_game_server_sessions
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server session not found for %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. verify they belong to the asserted canonical participant
  IF v_reservation.canonical_id <> p_canonical_id OR v_server.canonical_id <> p_canonical_id THEN
    RAISE EXCEPTION 'session % does not belong to canonical %', p_session_id, p_canonical_id USING ERRCODE = '42501';
  END IF;

  -- 3. return the existing result if already finalized
  IF v_reservation.status = 'finalized' THEN
    SELECT * INTO v_result FROM skill_game_sessions WHERE session_id = p_session_id;
    SELECT * INTO v_delivery FROM skill_game_reward_deliveries WHERE session_id = p_session_id;
    RETURN QUERY SELECT
      v_result.accepted, v_result.score, v_result.reward_miles, v_result.reward_stable,
      v_delivery.id, v_delivery.mode, v_delivery.status, v_delivery.destination_wallet, true;
    RETURN;
  END IF;

  -- 4. write the authoritative result and anti-abuse flags
  INSERT INTO skill_game_sessions (
    session_id, wallet_address, canonical_id, hub_user_id, source_app, game_type,
    score, reward_miles, reward_stable, accepted, anti_abuse_flags
  ) VALUES (
    p_session_id, NULL, p_canonical_id, v_reservation.hub_user_id, 'hub-page', v_reservation.game_type,
    p_score,
    CASE WHEN p_accepted THEN p_reward_miles ELSE 0 END,
    CASE WHEN p_accepted THEN p_reward_stable ELSE 0 END,
    p_accepted, COALESCE(p_anti_abuse_flags, '{}')
  )
  ON CONFLICT (session_id) DO UPDATE SET
    score = EXCLUDED.score,
    reward_miles = EXCLUDED.reward_miles,
    reward_stable = EXCLUDED.reward_stable,
    accepted = EXCLUDED.accepted,
    anti_abuse_flags = EXCLUDED.anti_abuse_flags
  RETURNING * INTO v_result;

  UPDATE skill_game_server_sessions
  SET finalized = true, completed = p_completed, score = p_score, updated_at = now()
  WHERE session_id = p_session_id AND finalized = false;

  -- 5. mark the reservation finalized
  UPDATE hub_skill_game_play_reservations
  SET status = 'finalized', finalized_at = now()
  WHERE session_id = p_session_id AND status IN ('reserved', 'started');

  -- 6. if reward is zero or the result is rejected, create no delivery
  IF NOT p_accepted OR p_reward_miles <= 0 THEN
    RETURN QUERY SELECT p_accepted, p_score, 0, 0::numeric, NULL::uuid, NULL::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  -- 8. reserve exactly one delivery (idempotent on session_id via unique constraint)
  SELECT * INTO v_delivery FROM skill_game_reward_deliveries WHERE session_id = p_session_id FOR UPDATE;
  IF v_delivery.id IS NULL THEN
    -- 7. resolve the member's current cryptographically verified primary
    -- wallet. Guarded the same way migration 054's backfill guards it: on a
    -- database where migration 051 (verified_wallet_linking.sql) hasn't run
    -- yet, hub_user_wallets.verification_status doesn't exist, and querying
    -- it directly would throw 42703 undefined_column on every rewarded
    -- finish. Treat that state as walletless (v_wallet stays NULL) rather
    -- than failing the whole finalization — same "a pre-051 row is not
    -- trusted as verified" stance migration 051 itself documents.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'hub_user_wallets' AND column_name = 'verification_status'
    ) THEN
      SELECT address INTO v_wallet
      FROM hub_user_wallets
      WHERE user_id = v_reservation.hub_user_id AND verification_status = 'verified'
      ORDER BY is_primary DESC NULLS LAST, linked_at ASC
      LIMIT 1;
    END IF;

    v_game_label := CASE v_reservation.game_type WHEN 'rule_tap' THEN 'Rule Tap' WHEN 'memory_flip' THEN 'Memory Flip' ELSE v_reservation.game_type END;

    INSERT INTO skill_game_reward_deliveries (
      session_id, canonical_id, mode, status, points, destination_wallet, idempotency_key
    ) VALUES (
      p_session_id, p_canonical_id,
      CASE WHEN v_wallet IS NOT NULL THEN 'onchain_mint' ELSE 'offchain_ledger' END,
      CASE WHEN v_wallet IS NOT NULL THEN 'pending' ELSE 'processing' END,
      p_reward_miles,
      lower(v_wallet),
      'skill-game-reward:' || p_session_id
    ) RETURNING * INTO v_delivery;

    -- 9. atomically credit the ledger (walletless) — onchain_mint stays
    -- `pending` here; the caller enqueues the actual minipoint_mint_jobs row
    -- (needs the session id in the job idempotency key, which this RPC
    -- doesn't own) and the mint worker completes/fails it from there (§11.3).
    IF v_delivery.mode = 'offchain_ledger' THEN
      INSERT INTO miles_ledger (
        canonical_id, amount, direction, source_type, source_id, on_chain, note
      ) VALUES (
        p_canonical_id, p_reward_miles, 'credit', 'skill_game', v_delivery.id, false,
        v_game_label || ' reward'
      ) RETURNING id INTO v_ledger_id;

      UPDATE skill_game_reward_deliveries SET
        status = 'completed',
        ledger_entry_id = v_ledger_id,
        external_ref = v_ledger_id::text,
        completed_at = now(),
        updated_at = now()
      WHERE id = v_delivery.id
      RETURNING * INTO v_delivery;
    END IF;
  END IF;

  -- 10. return the persisted result and delivery state
  RETURN QUERY SELECT
    v_result.accepted, v_result.score, v_result.reward_miles, v_result.reward_stable,
    v_delivery.id, v_delivery.mode, v_delivery.status, v_delivery.destination_wallet, false;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_hub_skill_game_session(text, uuid, integer, boolean, integer, numeric, boolean, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_hub_skill_game_session(text, uuid, integer, boolean, integer, numeric, boolean, text[])
  TO service_role;

-- ── 3. Worker completion/failure hooks (§11.3) ──────────────────────────────
-- Identical shape to complete/fail_api_partner_quest_delivery so the mint
-- worker's existing reconciliation pattern (confirmed mint + failed mirror
-- write -> reconcile from completed jobs without reminting) applies unchanged.

CREATE OR REPLACE FUNCTION public.complete_skill_game_reward_delivery(
  p_delivery_id  uuid,
  p_tx_hash      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE skill_game_reward_deliveries SET
    status = 'completed',
    external_ref = COALESCE(p_tx_hash, external_ref),
    completed_at = COALESCE(completed_at, now()),
    last_error = NULL,
    updated_at = now()
  WHERE id = p_delivery_id AND status <> 'completed';
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_skill_game_reward_delivery(
  p_delivery_id uuid,
  p_error       text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE skill_game_reward_deliveries SET
    status = 'failed',
    last_error = left(COALESCE(p_error, 'delivery failed'), 1000),
    attempts = attempts + 1,
    updated_at = now()
  WHERE id = p_delivery_id AND status <> 'completed';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_skill_game_reward_delivery(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_skill_game_reward_delivery(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_skill_game_reward_delivery(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_skill_game_reward_delivery(uuid, text) TO service_role;
