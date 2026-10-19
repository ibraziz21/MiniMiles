-- Manual fulfilment for account deletion.
--
-- Why this exists. The native-only scope decision of 2026-10-19
-- (packages/hub-page/docs/akiba-account-deletion-retention-decisions.md §"Scope
-- steering") deliberately holds shared Auth/identity/ledger effects back until
-- they are reviewed, and account_deletion_preflight enforces that by seeding
-- its blocker array with 'shared_account_scope_review'. That blocks the
-- automated pipeline by design, and it also blocks *accepting* a request,
-- because create_account_deletion_request refuses when the preflight is
-- non-empty. The result is an in-app deletion path that refuses everything —
-- which Google Play does not accept for an app that allows account creation.
--
-- Google's own guidance is that the flow "does not have to be an app where
-- they can login and request the deletion automatically; it can be a simple
-- form where they can request the deletion and you can get back to them
-- later". This migration implements exactly that, and nothing more: a
-- verified, member-initiated request, recorded for a human to carry out.
--
-- It does not touch the scope decision. No shared Platform data is read or
-- written here, and the automated worker never sees these rows.
--
-- The lockout trap is why 'manual_review' is a new status rather than reusing
-- 'requested'. accountDeletionAvailability.ts documents the bug this avoids:
-- an earlier build accepted requests, the pending-account guard locked the
-- member out of every protected route, and the worker then refused to process
-- anything — so members could be shut out of accounts that would never be
-- deleted. 'manual_review' is outside PENDING_DELETION_STATUSES and outside
-- the claimable index, so the member keeps access and the worker ignores it.

-- ── Status ──────────────────────────────────────────────────────────────────
ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_status_check;
ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_status_check
  CHECK (status IN ('requested','processing','legal_hold','failed',
                    'completed','cancelled','manual_review'));

-- uq_account_deletion_requests_open_user is WHERE status <> 'cancelled', so it
-- already holds one open request per member for the new status too. The
-- claimable index is WHERE status IN ('requested','failed'), so
-- claim_account_deletion_requests cannot pick these up.

-- ── Accepting a request for human fulfilment ────────────────────────────────
CREATE FUNCTION public.create_manual_account_deletion_request(
  p_hub_user_id uuid,p_challenge_id uuid,p_policy_version text,p_source text,
  p_target_days integer DEFAULT 14,p_contact_ciphertext bytea DEFAULT NULL,p_contact_key_version text DEFAULT NULL
) RETURNS TABLE(ok boolean,error_code text,request_id uuid,status text,requested_at timestamptz,
  target_completion_at timestamptz,already_requested boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE v_row record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_deletion:'||p_hub_user_id::text));

  -- Deliberately calls the v097 creator directly, skipping the preflight gate
  -- in create_account_deletion_request. That gate exists to stop a request
  -- being accepted that the *worker* cannot carry out; here no worker is
  -- involved. Every other check v097 performs — challenge ownership, consumed,
  -- expired, and the one-open-request short-circuit — still applies.
  SELECT * INTO v_row FROM public.create_account_deletion_request_v097(p_hub_user_id,p_challenge_id,
    p_policy_version,p_source,p_target_days,p_contact_ciphertext,p_contact_key_version);

  IF NOT v_row.ok OR v_row.already_requested THEN
    RETURN QUERY SELECT v_row.ok,v_row.error_code,v_row.request_id,v_row.status,
      v_row.requested_at,v_row.target_completion_at,v_row.already_requested;
    RETURN;
  END IF;

  -- v097 inserts 'requested', which fires revoke_deleted_member_access and
  -- voids unredeemed vouchers. That is the documented consequence of asking to
  -- delete (see legal copy §9) and is kept. Moving to 'manual_review' in the
  -- same transaction means no observer ever sees the pending status, so the
  -- member is never locked out.
  UPDATE public.account_deletion_requests
    SET status='manual_review', next_retry_at=NULL
    WHERE id=v_row.request_id;

  INSERT INTO public.account_deletion_events (request_id,event_type,actor_kind,metadata)
  VALUES (v_row.request_id,'manual_review_queued','system',
          jsonb_build_object('reason','shared_account_scope_review'));

  RETURN QUERY SELECT true,NULL::text,v_row.request_id,'manual_review'::text,
    v_row.requested_at,v_row.target_completion_at,false;
END $$;
REVOKE ALL ON FUNCTION public.create_manual_account_deletion_request(uuid,uuid,text,text,integer,bytea,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_account_deletion_request(uuid,uuid,text,text,integer,bytea,text)
  TO service_role;

-- ── The queue a human works from ────────────────────────────────────────────
-- Bounded on purpose: enough to find and prioritise the member, nothing more.
-- The encrypted completion contact is not exposed; whoever fulfils the request
-- resolves the member through hub_user_id.
CREATE OR REPLACE VIEW public.account_deletion_manual_queue AS
SELECT r.id AS request_id,
       r.hub_user_id,
       r.source,
       r.policy_version,
       r.requested_at,
       r.target_completion_at,
       (r.target_completion_at < now()) AS overdue,
       greatest(0,date_part('day',now()-r.requested_at)::int) AS days_outstanding
FROM public.account_deletion_requests r
WHERE r.status='manual_review'
ORDER BY r.requested_at;
REVOKE ALL ON public.account_deletion_manual_queue FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.account_deletion_manual_queue TO service_role;

-- ── Recording that a human finished ─────────────────────────────────────────
CREATE FUNCTION public.complete_manual_account_deletion_request(p_request_id uuid,p_actor text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE v_user uuid;
BEGIN
  -- IMPORTANT: this records a completion, it does not perform one. Calling it
  -- without having actually removed the member's data tells them their account
  -- is gone when it is not. That is a procedural guarantee, not a technical
  -- one, and it is the cost of manual fulfilment — see BDR-003.
  SELECT hub_user_id INTO v_user FROM public.account_deletion_requests
    WHERE id=p_request_id AND status='manual_review' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request is not awaiting manual review' USING ERRCODE='55000'; END IF;

  INSERT INTO public.account_deletion_events (request_id,event_type,actor_kind,metadata)
  VALUES (p_request_id,'manual_fulfilment_recorded','operator',
          jsonb_build_object('actor',left(coalesce(p_actor,'unknown'),64)));

  -- start_account_deletion_retention fires here: it sets the evidence and
  -- contact expiry clocks and nulls hub_user_id, which also releases the
  -- auth.users reference so the identity can be removed separately.
  UPDATE public.account_deletion_requests
    SET status='completed',completed_at=now()
    WHERE id=p_request_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_manual_account_deletion_request(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_manual_account_deletion_request(uuid,text) TO service_role;
