-- Implements the four deletion steps 103 left as declared-but-absent:
-- wallet_links, shared_profile_projection, canonical_identity, auth_identity.
--
-- 103 held these back ("shared account cleanup is outside native release
-- scope") because they touch data shared with the web Hub and the React app,
-- and because identity_links/miles_ledger are Akiba-Platform tables that this
-- repo does not define. That exclusion is reversed here; see
-- docs/BDR-002-native-deletion-shared-identity-scope.md for the reasoning and
-- what it costs.
--
-- What is NOT changed: account_deletion_preflight still seeds its blocker
-- array with 'shared_account_scope_review', so deletion continues to refuse
-- unconditionally. That tripwire is a policy decision, not an implementation
-- gap, and removing it is deliberately left to whoever owns it.
--
-- Pseudonymization of the canonical identity works by removing identity_links
-- rather than blanking a key: canonical_id is NOT NULL on both identity_links
-- and miles_ledger, so it cannot be nulled. identity_links is the only mapping
-- from a canonical id to a real person, so deleting it leaves miles_ledger
-- keyed by an opaque uuid — still usable as merchant-settlement evidence, no
-- longer attributable to a member.

CREATE OR REPLACE FUNCTION public.execute_account_deletion_step(p_request_id uuid, p_step text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE u uuid; blockers text[]; ids uuid[];
BEGIN
  SELECT hub_user_id INTO u FROM public.account_deletion_requests
    WHERE id=p_request_id AND status='processing' FOR UPDATE;
  IF u IS NULL THEN RAISE EXCEPTION 'request is not processing' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('account_deletion:' || u::text));
  PERFORM set_config('akiba.deletion_request',p_request_id::text,true);

  CASE p_step
  WHEN 'preflight' THEN
    blockers := public.account_deletion_preflight(u);
    IF cardinality(blockers)>0 THEN RAISE EXCEPTION 'deletion reconciliation required' USING ERRCODE='55000'; END IF;
  WHEN 'published_photos' THEN
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'moderation',jsonb_build_object('action',a.action,
      'reason_code',CASE WHEN a.reason_code ~ '^[a-z_]{1,64}$' THEN a.reason_code ELSE 'redacted' END,
      'before_status',a.before_status,'after_status',a.after_status,'occurred_at',a.created_at)
    FROM public.discovery_moderation_audit_events a JOIN public.merchant_visit_photos p ON p.id=a.photo_id
    WHERE p.hub_user_id=u;
    DELETE FROM public.discovery_moderation_audit_events a USING public.merchant_visit_photos p
      WHERE a.photo_id=p.id AND p.hub_user_id=u;
    DELETE FROM public.photo_processing_jobs WHERE photo_id IN (SELECT id FROM public.merchant_visit_photos WHERE hub_user_id=u);
    DELETE FROM public.merchant_visit_photos WHERE hub_user_id=u;
    DELETE FROM public.merchant_verified_visit_helpful_reactions WHERE contribution_id IN
      (SELECT id FROM public.merchant_discovery_contributions WHERE hub_user_id=u);
    DELETE FROM public.merchant_discovery_contribution_items WHERE contribution_id IN
      (SELECT id FROM public.merchant_discovery_contributions WHERE hub_user_id=u);
    DELETE FROM public.merchant_discovery_contributions WHERE hub_user_id=u;
  WHEN 'unpublished_contributions' THEN
    DELETE FROM public.merchant_discovery_item_mentions WHERE hub_user_id=u;
    DELETE FROM public.discovery_contribution_requests WHERE hub_user_id=u;
  WHEN 'wallet_links' THEN
    -- `unlink` severs the association with the external chain account. The
    -- row *is* the association and `address` is itself an identifier, so
    -- there is nothing to keep behind. Challenges are spent nonces.
    DELETE FROM public.wallet_link_challenges WHERE hub_user_id=u;
    DELETE FROM public.hub_user_wallets WHERE user_id=u;
  WHEN 'reward_ledger' THEN
    IF EXISTS (SELECT 1 FROM public.miles_spend_intents WHERE hub_user_id=u AND state NOT IN ('finalized','failed')) THEN
      RAISE EXCEPTION 'spend reconciliation required' USING ERRCODE='55000'; END IF;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'rewards',jsonb_build_object('kind','spend','amount',total_points,'state',state,
      'occurred_at',COALESCE(confirmed_at,failed_at,created_at)) FROM public.miles_spend_intents WHERE hub_user_id=u;
    DELETE FROM public.miles_ledger_holds WHERE hub_user_id=u;
    DELETE FROM public.miles_spend_intents WHERE hub_user_id=u;
  WHEN 'settlement_evidence' THEN
    IF EXISTS (SELECT 1 FROM public.mpesa_stk_requests WHERE hub_user_id=u) THEN
      RAISE EXCEPTION 'shared payment history needs separate policy' USING ERRCODE='55000'; END IF;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'rewards',jsonb_build_object('kind','redemption','amount',discount_applied,
      'occurred_at',redeemed_at) FROM public.voucher_redemptions WHERE hub_user_id=u;
    -- Outstanding/shared settlement references are refused by preflight;
    -- foreign keys are an additional fail-closed check if one appears later.
    DELETE FROM public.voucher_redemptions WHERE hub_user_id=u;
    DELETE FROM public.voucher_purchase_quotes WHERE hub_user_id=u;
  WHEN 'earning_events' THEN
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'rewards',jsonb_build_object('kind','earning','state',verification_status,
      'occurred_at',occurred_at) FROM public.verified_earning_events WHERE hub_user_id=u;
    DELETE FROM public.verified_earning_event_status_changes WHERE earning_event_id IN
      (SELECT id FROM public.verified_earning_events WHERE hub_user_id=u);
    DELETE FROM public.verified_earning_events WHERE hub_user_id=u;
    DELETE FROM public.hub_quest_action_proofs WHERE hub_user_id=u;
    -- Canonical identity/ledger cleanup is a separate required step: do not
    -- delete its mapping here before that cleanup can resolve ownership.
  WHEN 'skill_game_prizes' THEN
    IF EXISTS (SELECT 1 FROM public.skill_game_leaderboard_prize_deliveries WHERE hub_user_id=u) THEN
      RAISE EXCEPTION 'shared prize history needs separate policy' USING ERRCODE='55000'; END IF;
  WHEN 'active_vouchers' THEN
    DELETE FROM public.voucher_claim_intents WHERE hub_user_id=u;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'rewards',jsonb_build_object('kind','voucher','state',status,'occurred_at',created_at)
      FROM public.issued_vouchers WHERE hub_user_id=u;
    DELETE FROM public.voucher_events WHERE issued_voucher_id IN
      (SELECT id FROM public.issued_vouchers WHERE hub_user_id=u);
    DELETE FROM public.reconciliation_incidents WHERE voucher_id IN
      (SELECT id FROM public.issued_vouchers WHERE hub_user_id=u);
    DELETE FROM public.issued_vouchers WHERE hub_user_id=u;
  WHEN 'fraud_risk' THEN
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'security',jsonb_build_object('kind',flag_type,
      'reason_code',CASE WHEN reason_code ~ '^[a-z_]{1,64}$' THEN reason_code ELSE 'redacted' END,
      'occurred_at',created_at,'resolved_at',resolved_at) FROM public.hub_user_risk_flags WHERE hub_user_id=u;
    DELETE FROM public.hub_user_risk_flags WHERE hub_user_id=u;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'security',jsonb_build_object('kind','identity_merge','reason_code','identity_conflict',
      'occurred_at',created_at,'resolved_at',resolved_at) FROM public.identity_merge_incidents WHERE hub_user_id=u;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'security',jsonb_build_object('kind','identity_reconciliation','reason_code',
      CASE WHEN error_code ~ '^[A-Za-z0-9_]{1,32}$' THEN error_code ELSE 'redacted' END,
      'occurred_at',first_failed_at,'resolved_at',resolved_at) FROM public.hub_identity_reconciliation_failures WHERE hub_user_id=u;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'security',jsonb_build_object('kind','country_change','occurred_at',changed_at)
      FROM public.hub_profile_country_audit WHERE user_id=u OR actor=u;
    DELETE FROM public.identity_merge_incidents WHERE hub_user_id=u;
    DELETE FROM public.hub_identity_reconciliation_failures WHERE hub_user_id=u;
    DELETE FROM public.hub_profile_country_audit WHERE user_id=u OR actor=u;
  WHEN 'referrals' THEN
    IF EXISTS (SELECT 1 FROM public.referral_reward_jobs WHERE status='processing' AND
      (recipient_user_id=u OR referral_id IN (SELECT id FROM public.hub_referrals WHERE referrer_user_id=u OR referred_user_id=u))) THEN
      RAISE EXCEPTION 'referral reconciliation required' USING ERRCODE='55000'; END IF;
    INSERT INTO public.account_deletion_evidence(request_id,category,payload)
    SELECT p_request_id,'referrals',jsonb_build_object('milestone',milestone,'amount_miles',amount_miles,
      'state',status,'occurred_at',COALESCE(released_at,reversed_at,created_at)) FROM public.referral_reward_jobs
      WHERE status IN ('released','reversed') AND (recipient_user_id=u OR referral_id IN
        (SELECT id FROM public.hub_referrals WHERE referrer_user_id=u OR referred_user_id=u));
    DELETE FROM public.referral_events WHERE referral_id IN
      (SELECT id FROM public.hub_referrals WHERE referrer_user_id=u OR referred_user_id=u)
      OR actor_id=u::text;
    UPDATE public.referral_reward_jobs SET
      status=CASE WHEN status IN ('released','reversed') THEN status ELSE 'voided' END,
      voided_at=CASE WHEN status IN ('released','reversed') THEN voided_at ELSE now() END,
      recipient_user_id=CASE WHEN recipient_user_id=u THEN NULL ELSE recipient_user_id END,
      idempotency_key='deleted:'||id::text, platform_reference=NULL,
      last_error_detail=NULL,lease_owner=NULL,lease_expires_at=NULL,next_retry_at=NULL
    WHERE recipient_user_id=u OR referral_id IN
      (SELECT id FROM public.hub_referrals WHERE referrer_user_id=u OR referred_user_id=u);
    UPDATE public.hub_referrals SET
      referrer_user_id=CASE WHEN referrer_user_id=u THEN NULL ELSE referrer_user_id END,
      referred_user_id=CASE WHEN referred_user_id=u THEN NULL ELSE referred_user_id END,
      referred_pass_id=CASE WHEN referred_user_id=u THEN NULL ELSE referred_pass_id END,
      referral_code_id=CASE WHEN referral_code_id IN (SELECT id FROM public.hub_referral_codes WHERE hub_user_id=u)
        THEN NULL ELSE referral_code_id END,
      referral_click_id=NULL,qualification_reference=NULL,risk_reason_codes='{}',
      deletion_request_id=COALESCE(deletion_request_id,p_request_id)
    WHERE referrer_user_id=u OR referred_user_id=u;
    DELETE FROM public.referral_events WHERE referral_click_id IN (SELECT c.id FROM public.referral_clicks c
      JOIN public.hub_referral_codes rc ON rc.id=c.referral_code_id WHERE rc.hub_user_id=u);
    DELETE FROM public.referral_clicks WHERE referral_code_id IN (SELECT id FROM public.hub_referral_codes WHERE hub_user_id=u);
    DELETE FROM public.hub_referral_codes WHERE hub_user_id=u;
  WHEN 'pass_credentials' THEN
    DELETE FROM public.hub_user_passes WHERE user_id=u;
  WHEN 'notification_history' THEN
    IF to_regclass('public.miles_earned_notification_outbox') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.miles_earned_notification_outbox WHERE hub_user_id=$1' USING u;
    END IF;
    IF to_regclass('public.merchant_offer_reminders') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.merchant_offer_reminders WHERE canonical_id=$1' USING u;
    END IF;
    DELETE FROM public.notification_outbox WHERE hub_user_id=u;
  WHEN 'shared_profile_projection' THEN
    -- Leaderboards are a projection keyed by canonical_id, not hub_user_id.
    -- Both tables carry a username the member chose, so the projection is
    -- removed outright rather than blanked.
    ids := public.account_deletion_canonicals(u);
    DELETE FROM public.leaderboard_username_changes WHERE canonical_id=ANY(ids);
    DELETE FROM public.leaderboard_profiles WHERE canonical_id=ANY(ids);
  WHEN 'canonical_identity' THEN
    ids := public.account_deletion_canonicals(u);
    -- Admission already refuses a shared canonical, but re-check: admission
    -- and processing are separated in time, and a merge can land in between.
    -- Failing here is correct — it leaves the member's data intact.
    IF EXISTS (SELECT 1 FROM public.hub_user_canonicals WHERE canonical_id=ANY(ids) AND hub_user_id<>u)
        OR EXISTS (SELECT 1 FROM public.identity_links WHERE canonical_id=ANY(ids) AND identity_type<>'email') THEN
      RAISE EXCEPTION 'shared canonical identity' USING ERRCODE='55000';
    END IF;
    -- identity_links holds the email, so it is the mapping that makes the
    -- canonical id personal data. With it gone, miles_ledger rows survive
    -- under an id that resolves to nobody.
    DELETE FROM public.identity_links WHERE canonical_id=ANY(ids);
    DELETE FROM public.hub_user_canonicals WHERE hub_user_id=u;
  WHEN 'deletion_record' THEN
    -- Completion trigger starts retention clocks only on successful completion.
    NULL;
  WHEN 'auth_identity' THEN
    -- The request row is kept 24 months as proof the deletion happened, and
    -- it references auth.users. 103 dropped that column's NOT NULL for
    -- exactly this moment, so the reference is released in the same
    -- transaction as the delete. The completion trigger nulls it again later;
    -- that is idempotent.
    UPDATE public.account_deletion_requests SET hub_user_id=NULL WHERE id=p_request_id;
    -- auth.identities, auth.sessions and auth.refresh_tokens cascade from
    -- Supabase's own constraints. Access tokens already issued stay valid
    -- until they expire, which is equally true of the Admin API.
    DELETE FROM auth.users WHERE id=u;
  ELSE RAISE EXCEPTION 'unknown deletion step' USING ERRCODE='22023';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.execute_account_deletion_step(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion_step(uuid,text) TO service_role;
