-- Accepted native deletion behavior. This migration DOES NOT enable rollout.
-- Existing policy approval and submission/processing switches remain required.
-- Shared money-payment / prize / on-chain histories are deliberately refused
-- by preflight until their separate policies/executors are approved.

CREATE TABLE public.account_deletion_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id),
  category text NOT NULL CHECK (category IN ('moderation','security','rewards','referrals')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  hold_reason_code text,
  hold_owner text,
  hold_review_at timestamptz,
  CHECK ((hold_reason_code IS NULL AND hold_owner IS NULL AND hold_review_at IS NULL)
      OR (hold_reason_code IS NOT NULL AND hold_owner IS NOT NULL AND hold_review_at IS NOT NULL))
);
CREATE INDEX account_deletion_evidence_expiry ON public.account_deletion_evidence(expires_at);
ALTER TABLE public.account_deletion_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_evidence FROM PUBLIC, anon, authenticated, service_role;
-- No general support or merchant access. Writes/expiry go through narrow RPCs.

ALTER TABLE public.account_deletion_requests ALTER COLUMN hub_user_id DROP NOT NULL;
ALTER TABLE public.account_deletion_requests ADD COLUMN evidence_expires_at timestamptz;
ALTER TABLE public.account_deletion_requests ADD COLUMN completion_contact_expires_at timestamptz;

-- Preserve the other member's completed entitlement without requiring a
-- deleted member, Pass, code or tracking click to continue to exist.
ALTER TABLE public.hub_referrals ALTER COLUMN referrer_user_id DROP NOT NULL;
ALTER TABLE public.hub_referrals ALTER COLUMN referred_user_id DROP NOT NULL;
ALTER TABLE public.hub_referrals ALTER COLUMN referred_pass_id DROP NOT NULL;
ALTER TABLE public.hub_referrals ALTER COLUMN referral_code_id DROP NOT NULL;
ALTER TABLE public.hub_referrals ALTER COLUMN referral_click_id DROP NOT NULL;
ALTER TABLE public.hub_referrals ADD COLUMN deletion_request_id uuid REFERENCES public.account_deletion_requests(id);
ALTER TABLE public.hub_referrals ADD COLUMN evidence_expires_at timestamptz;
ALTER TABLE public.referral_reward_jobs ALTER COLUMN recipient_user_id DROP NOT NULL;

CREATE FUNCTION public.validate_deletion_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE allowed text[];
BEGIN
  allowed := CASE NEW.category
    WHEN 'moderation' THEN ARRAY['action','reason_code','before_status','after_status','occurred_at']
    WHEN 'security' THEN ARRAY['kind','reason_code','occurred_at','resolved_at']
    WHEN 'rewards' THEN ARRAY['kind','amount','direction','state','occurred_at']
    WHEN 'referrals' THEN ARRAY['milestone','amount_miles','state','occurred_at'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.payload) k WHERE NOT k = ANY(allowed))
     OR octet_length(NEW.payload::text) > 2048 THEN
    RAISE EXCEPTION 'invalid deletion evidence fields' USING ERRCODE = '23514';
  END IF;
  -- Strings are bounded machine codes/timestamps, never unbounded messages.
  IF EXISTS (SELECT 1 FROM jsonb_each(NEW.payload) e
     WHERE jsonb_typeof(e.value) NOT IN ('string','number','null')
        OR (jsonb_typeof(e.value) = 'string' AND
            (length(e.value #>> '{}') > 80 OR (e.value #>> '{}') !~ '^[A-Za-z0-9_.:+ -]*$'))) THEN
    RAISE EXCEPTION 'invalid deletion evidence values' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_deletion_evidence BEFORE INSERT OR UPDATE ON public.account_deletion_evidence
FOR EACH ROW EXECUTE FUNCTION public.validate_deletion_evidence();

-- The context is not sufficient by itself: audit deletion also requires the
-- SECURITY DEFINER owner, an active request, and that request's own photo.
CREATE OR REPLACE FUNCTION public.reject_discovery_moderation_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = pg_get_userbyid((SELECT proowner FROM pg_proc
       WHERE oid = 'public.execute_account_deletion_step(uuid,text)'::regprocedure))
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests r
       JOIN public.merchant_visit_photos p ON p.hub_user_id = r.hub_user_id
       WHERE r.id::text = current_setting('akiba.deletion_request', true)
         AND r.status = 'processing' AND p.id = OLD.photo_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'moderation audit is append-only outside controlled deletion' USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION public.fn_voucher_events_no_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT proowner FROM pg_proc
      WHERE oid='public.execute_account_deletion_step(uuid,text)'::regprocedure))
      AND EXISTS(SELECT 1 FROM public.account_deletion_requests r JOIN public.issued_vouchers v ON v.hub_user_id=r.hub_user_id
        WHERE r.id::text=current_setting('akiba.deletion_request',true) AND r.status='processing'
          AND v.id=OLD.issued_voucher_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'voucher events are append-only outside controlled deletion' USING ERRCODE='P0001';
END $$;

-- Native-only release: shared account lifecycle review is still required.
-- The scope blocker cannot be bypassed by environment flags.
-- Reconciliation blockers are checked before destroying anything, and again
-- under the request lock. Never guess a shared-service retention policy.
CREATE FUNCTION public.account_deletion_canonicals(p_user_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE(array_agg(DISTINCT c),'{}'::uuid[]) FROM (
    SELECT canonical_id AS c FROM public.hub_user_canonicals WHERE hub_user_id=p_user_id
    UNION SELECT l.canonical_id FROM public.identity_links l JOIN auth.users u
      ON l.identity_type='email' AND lower(btrim(l.identity_value))=lower(btrim(u.email)) WHERE u.id=p_user_id
  ) owned;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_canonicals(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.account_deletion_preflight(p_user_id uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE blockers text[] := ARRAY['shared_account_scope_review']; ids uuid[]; t record; populated boolean; email_value text;
BEGIN
  ids:=public.account_deletion_canonicals(p_user_id);
  SELECT lower(btrim(email)) INTO email_value FROM auth.users WHERE id=p_user_id;
  IF EXISTS (SELECT 1 FROM public.mpesa_stk_requests WHERE hub_user_id=p_user_id) THEN
    blockers := array_append(blockers,'shared_payment_history'); END IF;
  IF EXISTS (SELECT 1 FROM public.skill_game_leaderboard_prize_deliveries WHERE hub_user_id=p_user_id) THEN
    blockers := array_append(blockers,'shared_prize_history'); END IF;
  IF EXISTS (SELECT 1 FROM public.miles_spend_intents WHERE hub_user_id=p_user_id AND
      (onchain_points > 0 OR state NOT IN ('finalized','failed'))) THEN
    blockers := array_append(blockers,'spend_reconciliation_required'); END IF;
  IF EXISTS (SELECT 1 FROM public.referral_reward_jobs WHERE status='processing' AND
      (recipient_user_id=p_user_id OR referral_id IN
       (SELECT id FROM public.hub_referrals WHERE referrer_user_id=p_user_id OR referred_user_id=p_user_id))) THEN
    blockers := array_append(blockers,'referral_reconciliation_required'); END IF;
  IF EXISTS (SELECT 1 FROM public.photo_processing_jobs j JOIN public.merchant_visit_photos p ON p.id=j.photo_id
      WHERE p.hub_user_id=p_user_id AND j.status='processing') THEN
    blockers := array_append(blockers,'photo_reconciliation_required'); END IF;
  -- Unreviewed shared identity projections and merchant-settlement obligations
  -- must never be silently treated as native reward history.
  IF EXISTS (SELECT 1 FROM public.hub_user_canonicals WHERE canonical_id=ANY(ids) AND hub_user_id<>p_user_id)
      OR EXISTS(SELECT 1 FROM public.identity_links WHERE canonical_id=ANY(ids) AND identity_type<>'email') THEN
    blockers:=array_append(blockers,'shared_canonical_identity'); END IF;
  -- Scan actual base tables, not a hardcoded assumption that a canonical
  -- exists only in Hub. Newly deployed Platform tables fail closed if they
  -- contain this member until their cleanup is reviewed.
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables b
      ON b.table_schema=c.table_schema AND b.table_name=c.table_name
      WHERE c.table_schema='public' AND c.column_name='canonical_id' AND b.table_type='BASE TABLE'
        AND c.table_name NOT IN ('hub_user_canonicals','identity_links','miles_ledger',
          'miles_ledger_holds','verified_earning_events','leaderboard_profiles','leaderboard_username_changes') LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE canonical_id::text=ANY($1::text[]))',t.table_name)
      INTO populated USING ids;
    IF populated THEN blockers:=array_append(blockers,'shared_canonical_history'); EXIT; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.miles_ledger WHERE canonical_id=ANY(ids) AND COALESCE(on_chain,false)) THEN
    blockers:=array_append(blockers,'shared_onchain_history'); END IF;
  -- Platform can also address rewards directly by email/Auth id, bypassing
  -- canonical_id. These classes need explicit shared-service handlers.
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables b
      ON b.table_schema=c.table_schema AND b.table_name=c.table_name
      WHERE c.table_schema='public' AND c.column_name='identity_value' AND b.table_type='BASE TABLE'
        AND c.table_name<>'identity_links' LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE lower(btrim(identity_value::text))=$1)',t.table_name)
      INTO populated USING email_value;
    IF populated THEN blockers:=array_append(blockers,'shared_identity_history'); EXIT; END IF;
  END LOOP;
  IF to_regclass('public.rewards') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.rewards WHERE user_id=ANY($1))'
      INTO populated USING ARRAY[p_user_id::text,email_value];
    IF populated THEN blockers:=array_append(blockers,'shared_reward_history'); END IF;
  END IF;
  IF to_regclass('public.purchase_events') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.purchase_events WHERE lower(btrim(user_email))=$1)'
      INTO populated USING email_value;
    IF populated THEN blockers:=array_append(blockers,'shared_purchase_history'); END IF;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.users WHERE lower(btrim(email))=$1)'
      INTO populated USING email_value;
    IF populated THEN blockers:=array_append(blockers,'shared_legacy_profile'); END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.voucher_settlement_entries e JOIN public.issued_vouchers v ON v.id=e.issued_voucher_id
      WHERE v.hub_user_id=p_user_id) OR EXISTS
      (SELECT 1 FROM public.voucher_settlement_entries e JOIN public.voucher_redemptions r ON r.id=e.voucher_redemption_id
        WHERE r.hub_user_id=p_user_id) THEN
    blockers := array_append(blockers,'merchant_settlement_policy_required'); END IF;
  IF EXISTS (SELECT 1 FROM public.hub_referrals r JOIN public.referral_reward_jobs j ON j.referral_id=r.id
      WHERE (r.referrer_user_id=p_user_id OR r.referred_user_id=p_user_id) AND j.status='processing') THEN
    blockers := array_append(blockers,'referral_reconciliation_required'); END IF;
  -- Also catch ledger dependencies whose tables do not have canonical_id
  -- (for example purchase_refunds). Do not accept a request that will later
  -- fail only because the immutable financial FK graph was overlooked.
  FOR t IN SELECT n.nspname AS schema_name,c.relname AS table_name,a.attname AS column_name
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=f.conkey[1]
    WHERE f.contype='f' AND f.confrelid='public.miles_ledger'::regclass AND cardinality(f.conkey)=1 LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I c JOIN public.miles_ledger l ON c.%I=l.id WHERE l.canonical_id=ANY($1))',
      t.schema_name,t.table_name,t.column_name) INTO populated USING ids;
    IF populated THEN blockers:=array_append(blockers,'ledger_dependency_review'); EXIT; END IF;
  END LOOP;
  RETURN blockers;
END $$;
REVOKE ALL ON FUNCTION public.account_deletion_preflight(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_preflight(uuid) TO service_role;

ALTER FUNCTION public.create_account_deletion_request(uuid,uuid,text,text,integer,bytea,text)
  RENAME TO create_account_deletion_request_v097;
REVOKE ALL ON FUNCTION public.create_account_deletion_request_v097(uuid,uuid,text,text,integer,bytea,text)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_account_deletion_request(
  p_hub_user_id uuid,p_challenge_id uuid,p_policy_version text,p_source text,
  p_target_days integer DEFAULT 14,p_contact_ciphertext bytea DEFAULT NULL,p_contact_key_version text DEFAULT NULL
) RETURNS TABLE(ok boolean,error_code text,request_id uuid,status text,requested_at timestamptz,
  target_completion_at timestamptz,already_requested boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_deletion:'||p_hub_user_id::text));
  -- Existing receipts stay readable even if new blockers subsequently appear.
  IF NOT EXISTS(SELECT 1 FROM public.account_deletion_requests r
      WHERE r.hub_user_id=p_hub_user_id AND r.status<>'cancelled')
      AND cardinality(public.account_deletion_preflight(p_hub_user_id))>0 THEN
    RETURN QUERY SELECT false,'deletion_unavailable'::text,NULL::uuid,NULL::text,NULL::timestamptz,NULL::timestamptz,false;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.create_account_deletion_request_v097(p_hub_user_id,p_challenge_id,
    p_policy_version,p_source,p_target_days,p_contact_ciphertext,p_contact_key_version);
END $$;
REVOKE ALL ON FUNCTION public.create_account_deletion_request(uuid,uuid,text,text,integer,bytea,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_account_deletion_request(uuid,uuid,text,text,integer,bytea,text) TO service_role;

CREATE FUNCTION public.guard_deleted_member_writes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u uuid; candidate text; ctx text := current_setting('akiba.deletion_request',true); photo_owner uuid;
  candidates text[];
BEGIN
  -- Two deleting members can share a referral. A scoped cleanup may detach
  -- its own old link without being blocked by the other member's request.
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.account_deletion_requests r
      WHERE r.id::text=ctx AND r.status IN ('requested','processing')
        AND r.hub_user_id::text=ANY(ARRAY[to_jsonb(OLD)->>'hub_user_id',to_jsonb(OLD)->>'user_id',
          to_jsonb(OLD)->>'recipient_user_id',to_jsonb(OLD)->>'referrer_user_id',to_jsonb(OLD)->>'referred_user_id'])) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='photo_processing_jobs' THEN
    SELECT hub_user_id INTO photo_owner FROM public.merchant_visit_photos WHERE id=(to_jsonb(NEW)->>'photo_id')::uuid;
  END IF;
  candidates:=ARRAY[to_jsonb(NEW)->>'hub_user_id',to_jsonb(NEW)->>'user_id',
      to_jsonb(NEW)->>'recipient_user_id',to_jsonb(NEW)->>'referrer_user_id',to_jsonb(NEW)->>'referred_user_id',photo_owner::text];
  IF to_jsonb(NEW)->>'canonical_id' IS NOT NULL THEN
    candidates:=candidates || ARRAY(SELECT hub_user_id::text FROM public.hub_user_canonicals
      WHERE canonical_id::text=to_jsonb(NEW)->>'canonical_id');
    candidates:=candidates || ARRAY(SELECT a.id::text FROM public.identity_links l JOIN auth.users a
      ON l.identity_type='email' AND lower(btrim(l.identity_value))=lower(btrim(a.email))
      WHERE l.canonical_id::text=to_jsonb(NEW)->>'canonical_id');
  END IF;
  IF TG_TABLE_NAME='identity_links' AND to_jsonb(NEW)->>'identity_type'='email' THEN
    candidates:=candidates || ARRAY(SELECT a.id::text FROM auth.users a
      WHERE lower(btrim(a.email))=lower(btrim(to_jsonb(NEW)->>'identity_value')));
  END IF;
  FOREACH candidate IN ARRAY candidates LOOP
    IF candidate IS NULL THEN CONTINUE; END IF;
    IF candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
    u:=candidate::uuid;
    PERFORM pg_advisory_xact_lock(hashtext('account_deletion:'||u::text));
    IF EXISTS(SELECT 1 FROM public.account_deletion_requests r WHERE r.hub_user_id=u AND r.status<>'cancelled')
       AND NOT (current_user=pg_get_userbyid((SELECT proowner FROM pg_proc
         WHERE oid='public.execute_account_deletion_step(uuid,text)'::regprocedure))
         AND EXISTS(SELECT 1 FROM public.account_deletion_requests r WHERE r.id::text=ctx AND r.hub_user_id=u
           AND r.status IN ('requested','processing'))) THEN
      RAISE EXCEPTION 'account deletion in progress' USING ERRCODE='55000';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['merchant_visit_photos','photo_processing_jobs','merchant_discovery_contributions',
      'discovery_contribution_requests','verified_earning_events','miles_spend_intents','voucher_purchase_quotes',
      'hub_referrals','referral_reward_jobs','hub_referral_codes','hub_user_passes','issued_vouchers'] LOOP
    EXECUTE format('CREATE TRIGGER guard_deleted_member_writes BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_member_writes()',t);
  END LOOP;
END $$;

CREATE FUNCTION public.revoke_deleted_member_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM set_config('akiba.deletion_request',NEW.id::text,true);
  UPDATE public.issued_vouchers SET status='void',redemption_token_hash=NULL
    WHERE hub_user_id=NEW.hub_user_id AND status<>'redeemed';
  UPDATE public.hub_referral_codes SET status='disabled',disabled_at=now(),disabled_reason='account_deleted'
    WHERE hub_user_id=NEW.hub_user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER revoke_deleted_member_access AFTER INSERT ON public.account_deletion_requests
FOR EACH ROW WHEN (NEW.status='requested') EXECUTE FUNCTION public.revoke_deleted_member_access();

CREATE FUNCTION public.execute_account_deletion_step(p_request_id uuid, p_step text) RETURNS void
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
  WHEN 'canonical_identity' THEN
    RAISE EXCEPTION 'shared account cleanup is outside native release scope' USING ERRCODE='55000';
  WHEN 'deletion_record' THEN
    -- Completion trigger starts retention clocks only on successful completion.
    NULL;
  ELSE RAISE EXCEPTION 'unknown deletion step' USING ERRCODE='22023';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.execute_account_deletion_step(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion_step(uuid,text) TO service_role;

-- Shared Auth/identity/ledger effects remain outside this release pending review.
CREATE FUNCTION public.start_account_deletion_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    IF NEW.completed_at IS NULL THEN RAISE EXCEPTION 'completion time required'; END IF;
    NEW.evidence_expires_at := NEW.completed_at + interval '24 months';
    -- Bounded operational delivery window, including a provider outage.
    NEW.completion_contact_expires_at := NEW.completed_at + interval '24 hours';
    UPDATE public.account_deletion_evidence SET expires_at=NEW.completed_at +
      CASE WHEN category='moderation' THEN interval '90 days' ELSE interval '180 days' END
      WHERE request_id=NEW.id AND expires_at IS NULL;
    UPDATE public.hub_referrals SET evidence_expires_at=NEW.completed_at + interval '180 days'
      WHERE deletion_request_id=NEW.id AND evidence_expires_at IS NULL;
    -- Completion proof does not need an enduring shared identity link.
    -- Activation is blocked pending native/shared account lifecycle review.
    NEW.hub_user_id := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER start_account_deletion_retention BEFORE UPDATE ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.start_account_deletion_retention();

CREATE FUNCTION public.expire_account_deletion_evidence(p_limit integer DEFAULT 500) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE removed integer; expired_referrals uuid[];
BEGIN
  IF p_limit < 1 OR p_limit > 5000 THEN RAISE EXCEPTION 'invalid expiry batch'; END IF;
  UPDATE public.account_deletion_requests SET completion_contact_ciphertext=NULL,
    completion_contact_key_version=NULL,completion_email_lease_expires_at=NULL,
    completion_email_next_retry_at=NULL
    WHERE status='completed' AND completion_contact_expires_at<=now()
      AND completion_contact_ciphertext IS NOT NULL;
  WITH victims AS (SELECT e.id FROM public.account_deletion_evidence e
    JOIN public.account_deletion_requests r ON r.id=e.request_id
    WHERE r.status='completed' AND e.expires_at<=now() AND e.hold_reason_code IS NULL
      AND r.hold_reason_code IS NULL
    ORDER BY e.expires_at LIMIT p_limit FOR UPDATE OF e SKIP LOCKED)
  DELETE FROM public.account_deletion_evidence e USING victims v WHERE e.id=v.id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  -- Do not erase another member's live/held evidence or leave dangling jobs.
  SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO expired_referrals FROM
    (SELECT f.id FROM public.hub_referrals f JOIN public.account_deletion_requests r ON r.id=f.deletion_request_id
      WHERE f.evidence_expires_at<=now() AND r.status='completed' AND r.hold_reason_code IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.account_deletion_evidence e WHERE e.request_id=r.id
          AND e.category='referrals' AND e.hold_reason_code IS NOT NULL)
      ORDER BY f.evidence_expires_at LIMIT p_limit FOR UPDATE OF f SKIP LOCKED) due;
  DELETE FROM public.referral_events WHERE referral_id=ANY(expired_referrals);
  DELETE FROM public.referral_reward_jobs WHERE referral_id=ANY(expired_referrals);
  DELETE FROM public.hub_referrals WHERE id=ANY(expired_referrals);
  -- Proof is deleted only once all held/longer-lived evidence is gone and
  -- no completion contact or mail lease remains. Never purge active work.
  WITH victims AS (SELECT r.id FROM public.account_deletion_requests r
    WHERE r.status='completed' AND r.evidence_expires_at<=now() AND r.hold_reason_code IS NULL
      AND r.completion_contact_ciphertext IS NULL AND r.completion_email_lease_expires_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.account_deletion_evidence e WHERE e.request_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM public.hub_referrals f WHERE f.deletion_request_id=r.id)
    ORDER BY r.evidence_expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED),
  events AS (DELETE FROM public.account_deletion_events e USING victims v WHERE e.request_id=v.id)
  DELETE FROM public.account_deletion_requests r USING victims v WHERE r.id=v.id;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.expire_account_deletion_evidence(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_account_deletion_evidence(integer) TO service_role;

-- An hourly sender must not send an expired contact while waiting for the
-- daily expiry job. Keep the existing claim/lease behavior behind a wrapper.
ALTER FUNCTION public.claim_account_deletion_completion_emails(integer,integer)
  RENAME TO claim_account_deletion_completion_emails_v097;
REVOKE ALL ON FUNCTION public.claim_account_deletion_completion_emails_v097(integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_account_deletion_completion_emails(p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.account_deletion_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.account_deletion_requests SET completion_contact_ciphertext=NULL,
    completion_contact_key_version=NULL,completion_email_lease_expires_at=NULL,
    completion_email_next_retry_at=NULL
    WHERE status='completed' AND completion_contact_expires_at<=now() AND completion_contact_ciphertext IS NOT NULL;
  RETURN QUERY SELECT * FROM public.claim_account_deletion_completion_emails_v097(p_limit,p_lease_seconds);
END $$;
REVOKE ALL ON FUNCTION public.claim_account_deletion_completion_emails(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_completion_emails(integer,integer) TO service_role;
