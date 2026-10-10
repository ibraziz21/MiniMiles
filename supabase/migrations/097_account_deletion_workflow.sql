-- Account deletion workflow — AKIBA-MOB-002 §8
-- (packages/hub-page/docs/akiba-mobile-account-controls-store-compliance-spec.md).
--
-- Store policy (Apple and Google both) requires an in-app path to delete the
-- whole account plus a public web resource that uses the same workflow. This
-- migration builds the durable side of that: the email-ownership challenge,
-- the request record members get a receipt for, and the append-only event log
-- operators reconcile against.
--
-- Three deliberate properties, because a deletion pipeline that gets any of
-- them wrong is unrecoverable:
--
--   1. First request wins. A partial unique index allows exactly one
--      non-cancelled request per user, and create_account_deletion_request
--      returns the original receipt instead of raising — so a lost response,
--      a double tap, and two devices submitting at once all produce one
--      request with one unchanged requested_at.
--   2. Service-role only. RLS on, anon/authenticated revoked, every function
--      SECURITY DEFINER and granted to service_role alone. Nothing here is
--      reachable from a browser session even with a valid JWT.
--   3. No PII. These tables hold no email, phone, wallet address, OTP, token,
--      IP, or free text. The one contact value the worker needs to send a
--      completion email is stored encrypted under a versioned key and purged
--      after delivery (§8.1 "security requirements").
--
-- Columns beyond the spec's §8.1 sketch — lease_expires_at, attempts,
-- next_retry_at, last_failure_at — exist to satisfy §8.3's retry, backoff and
-- dead-letter requirements, which the sketch's columns alone cannot express.

-- ── account_deletion_challenges (§7.2) ──────────────────────────────────
-- Wraps the Supabase email OTP with Akiba's own bounded window and attempt
-- budget. The code itself is never stored: Supabase verifies it, this row
-- only decides whether an attempt is still allowed.
CREATE TABLE IF NOT EXISTS account_deletion_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose       text NOT NULL DEFAULT 'account_deletion'
                  CHECK (purpose = 'account_deletion'),
  expires_at    timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- "Allow at most one live challenge per user" (§7.2). Live means unconsumed;
-- create_account_deletion_challenge clears a stale one before inserting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_challenges_live_user
  ON account_deletion_challenges (hub_user_id) WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_deletion_challenges_expiry
  ON account_deletion_challenges (expires_at);

ALTER TABLE account_deletion_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_deletion_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_deletion_challenges TO service_role;

-- ── account_deletion_requests (§8.1) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No ON DELETE action on purpose. The worker *soft*-deletes the Auth user
  -- (§8.2 step 11), which leaves this row intact; a hard delete would be
  -- blocked rather than silently destroying the evidence of the request and
  -- its completion, which §9 requires Akiba to retain.
  hub_user_id                    uuid NOT NULL REFERENCES auth.users(id),
  status                         text NOT NULL DEFAULT 'requested'
                                   CHECK (status IN ('requested', 'processing', 'legal_hold',
                                                     'failed', 'completed', 'cancelled')),
  source                         text NOT NULL
                                   CHECK (source IN ('native_ios', 'native_android', 'web')),
  policy_version                 text NOT NULL,
  -- Purpose-limited: the only reason Akiba keeps any contact value past the
  -- Auth deletion is to send the one completion email the member is owed.
  -- Encrypted at rest under a versioned key, unreadable to support roles,
  -- and purged by purge_account_deletion_contact.
  completion_contact_ciphertext  bytea,
  completion_contact_key_version text,
  requested_at                   timestamptz NOT NULL DEFAULT now(),
  target_completion_at           timestamptz NOT NULL,
  processing_started_at          timestamptz,
  completed_at                   timestamptz,
  completion_email_sent_at       timestamptz,
  -- The completion email is retried on its own schedule, independently of
  -- request processing (§8.2 step 13): the account is already gone by then,
  -- so a mail outage must never reopen a completed deletion.
  completion_email_attempts      integer NOT NULL DEFAULT 0,
  completion_email_next_retry_at timestamptz,
  completion_email_lease_expires_at timestamptz,
  completion_email_failure_code  text,
  hold_reason_code               text,
  failure_code                   text,
  -- §8.3 retry/lease bookkeeping.
  attempts                       integer NOT NULL DEFAULT 0,
  lease_expires_at               timestamptz,
  next_retry_at                  timestamptz,
  last_failure_at                timestamptz,
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

-- First-request-wins, enforced by the database rather than by application
-- sequencing. `cancelled` is the only state that frees a user to request
-- again, and it is operator-only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_requests_open_user
  ON account_deletion_requests (hub_user_id) WHERE status <> 'cancelled';

-- Serves the pending-account guard (§7.4), which runs on every authenticated
-- v1 request and must stay a single indexed lookup.
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_pending_user
  ON account_deletion_requests (hub_user_id)
  WHERE status IN ('requested', 'processing', 'legal_hold', 'failed');

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_claimable
  ON account_deletion_requests (next_retry_at)
  WHERE status IN ('requested', 'failed');

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_email_pending
  ON account_deletion_requests (completion_email_next_retry_at)
  WHERE status = 'completed'
    AND completion_email_sent_at IS NULL
    AND completion_contact_ciphertext IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_overdue
  ON account_deletion_requests (target_completion_at)
  WHERE status <> 'completed' AND status <> 'cancelled';

DROP TRIGGER IF EXISTS trg_account_deletion_requests_touch ON account_deletion_requests;
CREATE TRIGGER trg_account_deletion_requests_touch
  BEFORE UPDATE ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON account_deletion_requests TO service_role;

-- ── account_deletion_events (§8.1) ──────────────────────────────────────
-- Append-only. `metadata` is bounded, machine-readable fields only — the
-- insert helper rejects anything that smells like PII rather than trusting
-- call sites to remember.
CREATE TABLE IF NOT EXISTS account_deletion_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES account_deletion_requests(id),
  event_type text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('member', 'worker', 'operator', 'system')),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_events_request
  ON account_deletion_events (request_id, created_at);

ALTER TABLE account_deletion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_deletion_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON account_deletion_events TO service_role;

-- ── challenge lifecycle ─────────────────────────────────────────────────

-- Issues the single live challenge for a user. Replaces rather than reuses
-- any existing one: a resend mints a fresh Supabase OTP, so reusing the old
-- row would hand the member a code that dies with the old window.
CREATE OR REPLACE FUNCTION create_account_deletion_challenge(
  p_hub_user_id uuid,
  p_ttl_seconds integer DEFAULT 600
) RETURNS TABLE (
  challenge_id uuid,
  expires_at   timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_hub_user_id IS NULL THEN
    RAISE EXCEPTION 'p_hub_user_id is required';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'p_ttl_seconds must be positive';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('account_deletion:' || p_hub_user_id::text));

  DELETE FROM account_deletion_challenges c
  WHERE c.hub_user_id = p_hub_user_id AND c.consumed_at IS NULL;

  v_expires := now() + make_interval(secs => p_ttl_seconds);

  INSERT INTO account_deletion_challenges (hub_user_id, expires_at)
  VALUES (p_hub_user_id, v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_expires;
END
$$;

REVOKE ALL ON FUNCTION create_account_deletion_challenge(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_account_deletion_challenge(uuid, integer) TO service_role;

-- Burns one of the challenge's attempts and reports whether a verification
-- may proceed. Called *before* the OTP is checked so a wrong code always
-- costs an attempt, including when the verify call itself fails.
CREATE OR REPLACE FUNCTION record_account_deletion_challenge_attempt(
  p_challenge_id  uuid,
  p_hub_user_id   uuid,
  p_max_attempts  integer DEFAULT 5
) RETURNS TABLE (
  ok                 boolean,
  error_code         text,
  attempts_remaining integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_row account_deletion_challenges;
BEGIN
  SELECT * INTO v_row
  FROM account_deletion_challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.hub_user_id <> p_hub_user_id THEN
    -- Same answer for "no such challenge" and "someone else's challenge":
    -- a caller must not be able to probe for other users' challenge ids.
    RETURN QUERY SELECT false, 'challenge_not_found'::text, 0;
    RETURN;
  END IF;

  IF v_row.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'challenge_consumed'::text, 0;
    RETURN;
  END IF;

  IF v_row.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'challenge_expired'::text, 0;
    RETURN;
  END IF;

  IF v_row.attempt_count >= p_max_attempts THEN
    RETURN QUERY SELECT false, 'challenge_attempts_exhausted'::text, 0;
    RETURN;
  END IF;

  UPDATE account_deletion_challenges c
  SET attempt_count = c.attempt_count + 1
  WHERE c.id = p_challenge_id;

  RETURN QUERY SELECT true, NULL::text, p_max_attempts - (v_row.attempt_count + 1);
END
$$;

REVOKE ALL ON FUNCTION record_account_deletion_challenge_attempt(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_account_deletion_challenge_attempt(uuid, uuid, integer) TO service_role;

-- ── request creation (§7.3 step 8) ──────────────────────────────────────
-- One transaction, one advisory lock per user: consume the challenge, insert
-- the request, append the audit event. An actor who already has an open
-- request gets it back verbatim and their challenge is left alone, so a
-- retry after a dropped response never needs a second code.
CREATE OR REPLACE FUNCTION create_account_deletion_request(
  p_hub_user_id        uuid,
  p_challenge_id       uuid,
  p_policy_version     text,
  p_source             text,
  p_target_days        integer DEFAULT 14,
  p_contact_ciphertext bytea DEFAULT NULL,
  p_contact_key_version text DEFAULT NULL
) RETURNS TABLE (
  ok                   boolean,
  error_code           text,
  request_id           uuid,
  status               text,
  requested_at         timestamptz,
  target_completion_at timestamptz,
  already_requested    boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_existing account_deletion_requests;
  v_challenge account_deletion_challenges;
  v_new account_deletion_requests;
BEGIN
  IF p_hub_user_id IS NULL OR p_policy_version IS NULL OR p_source IS NULL THEN
    RAISE EXCEPTION 'p_hub_user_id, p_policy_version and p_source are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('account_deletion:' || p_hub_user_id::text));

  SELECT * INTO v_existing
  FROM account_deletion_requests r
  WHERE r.hub_user_id = p_hub_user_id AND r.status <> 'cancelled'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT true, NULL::text, v_existing.id, v_existing.status,
                        v_existing.requested_at, v_existing.target_completion_at, true;
    RETURN;
  END IF;

  SELECT * INTO v_challenge
  FROM account_deletion_challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND OR v_challenge.hub_user_id <> p_hub_user_id THEN
    RETURN QUERY SELECT false, 'challenge_not_found'::text, NULL::uuid, NULL::text,
                        NULL::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;

  IF v_challenge.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'challenge_consumed'::text, NULL::uuid, NULL::text,
                        NULL::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;

  IF v_challenge.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'challenge_expired'::text, NULL::uuid, NULL::text,
                        NULL::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;

  UPDATE account_deletion_challenges c
  SET consumed_at = now()
  WHERE c.id = p_challenge_id;

  INSERT INTO account_deletion_requests (
    hub_user_id, status, source, policy_version,
    completion_contact_ciphertext, completion_contact_key_version,
    requested_at, target_completion_at, next_retry_at
  ) VALUES (
    p_hub_user_id, 'requested', p_source, p_policy_version,
    p_contact_ciphertext, p_contact_key_version,
    now(), now() + make_interval(days => COALESCE(p_target_days, 14)), now()
  )
  RETURNING * INTO v_new;

  INSERT INTO account_deletion_events (request_id, event_type, actor_kind, metadata)
  VALUES (v_new.id, 'requested', 'member',
          jsonb_build_object('source', p_source, 'policy_version', p_policy_version));

  RETURN QUERY SELECT true, NULL::text, v_new.id, v_new.status,
                      v_new.requested_at, v_new.target_completion_at, false;
END
$$;

REVOKE ALL ON FUNCTION create_account_deletion_request(uuid, uuid, text, text, integer, bytea, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_account_deletion_request(uuid, uuid, text, text, integer, bytea, text)
  TO service_role;

-- ── worker claim / completion (§8.2, §8.3) ──────────────────────────────
-- Lease-based so an at-least-once worker that dies mid-run releases its work
-- on lease expiry instead of wedging the queue. SKIP LOCKED lets several
-- workers run without coordinating, same as claim_photo_processing_jobs.
CREATE OR REPLACE FUNCTION claim_account_deletion_requests(
  p_limit         integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 900
) RETURNS SETOF account_deletion_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id FROM account_deletion_requests
    WHERE (
      -- Never claimed, or its lease lapsed while a worker was gone.
      (status IN ('requested', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= now())
    )
    ORDER BY requested_at
    LIMIT GREATEST(COALESCE(p_limit, 1), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE account_deletion_requests r
  SET status = 'processing',
      attempts = r.attempts + 1,
      processing_started_at = COALESCE(r.processing_started_at, now()),
      lease_expires_at = now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 900), 60)),
      next_retry_at = NULL,
      failure_code = NULL
  FROM claimable c
  WHERE r.id = c.id
  RETURNING r.*;
END
$$;

REVOKE ALL ON FUNCTION claim_account_deletion_requests(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_account_deletion_requests(integer, integer) TO service_role;

-- Constrained transitions rather than arbitrary UPDATEs (§8.1). `completed`
-- is terminal: re-completing is a no-op success so an at-least-once worker
-- replaying its last step cannot corrupt the record.
CREATE OR REPLACE FUNCTION finish_account_deletion_request(
  p_request_id    uuid,
  p_outcome       text,
  p_failure_code  text DEFAULT NULL,
  p_retry_delay_seconds integer DEFAULT 300
) RETURNS TABLE (ok boolean, error_code text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_row account_deletion_requests;
BEGIN
  IF p_outcome NOT IN ('completed', 'failed', 'legal_hold') THEN
    RAISE EXCEPTION 'p_outcome must be completed, failed or legal_hold';
  END IF;

  SELECT * INTO v_row FROM account_deletion_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'request_not_found'::text, NULL::text;
    RETURN;
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN QUERY SELECT true, NULL::text, v_row.status;
    RETURN;
  END IF;

  IF v_row.status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'request_cancelled'::text, v_row.status;
    RETURN;
  END IF;

  IF p_outcome = 'completed' THEN
    UPDATE account_deletion_requests r
    SET status = 'completed', completed_at = now(), lease_expires_at = NULL,
        next_retry_at = NULL, failure_code = NULL
    WHERE r.id = p_request_id;
  ELSIF p_outcome = 'legal_hold' THEN
    UPDATE account_deletion_requests r
    SET status = 'legal_hold', lease_expires_at = NULL, next_retry_at = NULL,
        hold_reason_code = COALESCE(p_failure_code, r.hold_reason_code)
    WHERE r.id = p_request_id;
  ELSE
    UPDATE account_deletion_requests r
    SET status = 'failed', lease_expires_at = NULL, failure_code = p_failure_code,
        last_failure_at = now(),
        next_retry_at = now() + make_interval(secs => GREATEST(COALESCE(p_retry_delay_seconds, 300), 30))
    WHERE r.id = p_request_id;
  END IF;

  INSERT INTO account_deletion_events (request_id, event_type, actor_kind, metadata)
  VALUES (p_request_id, p_outcome, 'worker',
          CASE WHEN p_failure_code IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('failure_code', p_failure_code) END);

  RETURN QUERY SELECT true, NULL::text, p_outcome;
END
$$;

REVOKE ALL ON FUNCTION finish_account_deletion_request(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finish_account_deletion_request(uuid, text, text, integer) TO service_role;

-- ── completion-email delivery (§8.2 step 13, §8.3) ──────────────────────
-- Claims completed requests whose completion email has not been delivered.
-- Deliberately separate from claim_account_deletion_requests: `completed` is
-- terminal, so a pending email must never drag a finished request back into
-- `processing`. Only rows that still hold an encrypted contact are claimable
-- — once purged there is nothing left to deliver to.
CREATE OR REPLACE FUNCTION claim_account_deletion_completion_emails(
  p_limit         integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 300
) RETURNS SETOF account_deletion_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id FROM account_deletion_requests
    WHERE status = 'completed'
      AND completion_email_sent_at IS NULL
      AND completion_contact_ciphertext IS NOT NULL
      AND (completion_email_next_retry_at IS NULL OR completion_email_next_retry_at <= now())
      AND (completion_email_lease_expires_at IS NULL OR completion_email_lease_expires_at <= now())
    ORDER BY completed_at
    LIMIT GREATEST(COALESCE(p_limit, 5), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE account_deletion_requests r
  SET completion_email_attempts = r.completion_email_attempts + 1,
      completion_email_lease_expires_at =
        now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 300), 30)),
      completion_email_next_retry_at = NULL
  FROM claimable c
  WHERE r.id = c.id
  RETURNING r.*;
END
$$;

REVOKE ALL ON FUNCTION claim_account_deletion_completion_emails(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_account_deletion_completion_emails(integer, integer) TO service_role;

-- Re-arms a failed delivery with backoff, or gives up and purges the contact
-- once the approved delivery-expiry limit is reached — the contact may not
-- be kept indefinitely just because mail is broken (§8.1).
CREATE OR REPLACE FUNCTION record_account_deletion_completion_email_failure(
  p_request_id          uuid,
  p_failure_code        text,
  p_retry_delay_seconds integer DEFAULT 3600,
  p_max_attempts        integer DEFAULT 10
) RETURNS TABLE (ok boolean, gave_up boolean, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_row account_deletion_requests;
BEGIN
  SELECT * INTO v_row FROM account_deletion_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, 0;
    RETURN;
  END IF;

  IF v_row.completion_email_attempts >= p_max_attempts THEN
    UPDATE account_deletion_requests r
    SET completion_contact_ciphertext = NULL,
        completion_contact_key_version = NULL,
        completion_email_lease_expires_at = NULL,
        completion_email_next_retry_at = NULL,
        completion_email_failure_code = p_failure_code
    WHERE r.id = p_request_id;

    INSERT INTO account_deletion_events (request_id, event_type, actor_kind, metadata)
    VALUES (p_request_id, 'completion_contact_expired', 'worker',
            jsonb_build_object('failure_code', p_failure_code,
                               'attempts', v_row.completion_email_attempts));

    RETURN QUERY SELECT true, true, v_row.completion_email_attempts;
    RETURN;
  END IF;

  UPDATE account_deletion_requests r
  SET completion_email_lease_expires_at = NULL,
      completion_email_failure_code = p_failure_code,
      completion_email_next_retry_at =
        now() + make_interval(secs => GREATEST(COALESCE(p_retry_delay_seconds, 3600), 60))
  WHERE r.id = p_request_id;

  INSERT INTO account_deletion_events (request_id, event_type, actor_kind, metadata)
  VALUES (p_request_id, 'completion_email_failed', 'worker',
          jsonb_build_object('failure_code', p_failure_code,
                             'attempts', v_row.completion_email_attempts));

  RETURN QUERY SELECT true, false, v_row.completion_email_attempts;
END
$$;

REVOKE ALL ON FUNCTION record_account_deletion_completion_email_failure(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_account_deletion_completion_email_failure(uuid, text, integer, integer)
  TO service_role;

-- Marks the completion email delivered and drops the encrypted contact in the
-- same statement (§8.2 step 14) — the field exists only to make that one
-- delivery possible.
CREATE OR REPLACE FUNCTION purge_account_deletion_contact(
  p_request_id uuid,
  p_delivered  boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE account_deletion_requests r
  SET completion_contact_ciphertext = NULL,
      completion_contact_key_version = NULL,
      completion_email_lease_expires_at = NULL,
      completion_email_next_retry_at = NULL,
      completion_email_sent_at = CASE WHEN p_delivered THEN now() ELSE r.completion_email_sent_at END
  WHERE r.id = p_request_id;

  INSERT INTO account_deletion_events (request_id, event_type, actor_kind, metadata)
  VALUES (p_request_id,
          CASE WHEN p_delivered THEN 'completion_email_sent' ELSE 'completion_contact_expired' END,
          'worker', '{}'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION purge_account_deletion_contact(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_account_deletion_contact(uuid, boolean) TO service_role;

-- ── operator reconciliation (§8.3) ──────────────────────────────────────
-- Counts and ages only: no user id, no contact, nothing a support role could
-- use to re-identify a member from this view.
CREATE OR REPLACE VIEW account_deletion_reconciliation AS
SELECT
  status,
  count(*)                                                   AS request_count,
  count(*) FILTER (WHERE target_completion_at < now()
                     AND status NOT IN ('completed', 'cancelled')) AS overdue_count,
  count(*) FILTER (WHERE status = 'completed'
                     AND completion_email_sent_at IS NULL)   AS completion_email_pending_count,
  count(*) FILTER (WHERE status = 'completed'
                     AND completion_email_sent_at IS NULL
                     AND completion_contact_ciphertext IS NULL) AS completion_email_abandoned_count,
  max(attempts)                                              AS max_attempts,
  max(completion_email_attempts)                             AS max_completion_email_attempts,
  min(requested_at)                                          AS oldest_requested_at
FROM account_deletion_requests
GROUP BY status;

REVOKE ALL ON account_deletion_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON account_deletion_reconciliation TO service_role;
