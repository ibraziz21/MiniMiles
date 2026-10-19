-- Operator-driven full shared-account erasure. Scope approved 2026-10-19.
-- Requires 103,105,106 and the admin_users table. No production enablement.
CREATE TABLE public.account_deletion_admin_cases (
 request_id uuid PRIMARY KEY REFERENCES public.account_deletion_requests(id) ON DELETE CASCADE,
 assignee uuid NOT NULL, state text NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','running','failed','verified')),
 run_token uuid, lease_until timestamptz, failure_code text,
 storage_manifest jsonb NOT NULL DEFAULT '[]', verified_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_admin_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_admin_cases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.account_deletion_admin_cases TO service_role;

CREATE FUNCTION public.require_deletion_operator(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE id=p_actor AND is_active AND role::text IN ('super_admin','ops_admin')) THEN
  RAISE EXCEPTION 'authorized named operator required' USING ERRCODE='42501';
 END IF;
END $$;

-- Counts only; discovers unhandled member-linked schema without exposing rows.
CREATE FUNCTION public.admin_deletion_member_counts(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c record; n bigint; counts jsonb := '{}';
BEGIN
 FOR c IN SELECT col.table_name,col.column_name FROM information_schema.columns col
  JOIN information_schema.tables t USING(table_schema,table_name)
  WHERE col.table_schema='public' AND t.table_type='BASE TABLE'
  AND col.column_name IN ('hub_user_id','user_id','recipient_user_id','referrer_user_id','referred_user_id')
  AND col.data_type IN ('uuid','text','character varying')
  AND col.table_name<>'account_deletion_requests'
 UNION
 SELECT cls.relname,att.attname FROM pg_constraint fk JOIN pg_class cls ON cls.oid=fk.conrelid
 JOIN pg_namespace ns ON ns.oid=cls.relnamespace
 JOIN pg_attribute att ON att.attrelid=cls.oid AND att.attnum=fk.conkey[1]
 WHERE fk.contype='f' AND fk.confrelid='auth.users'::regclass AND cardinality(fk.conkey)=1
 AND ns.nspname='public' AND cls.relname<>'account_deletion_requests'
 LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text=$1',c.table_name,c.column_name) INTO n USING p_user::text;
  IF n>0 THEN counts:=counts || jsonb_build_object(c.table_name||'.'||c.column_name,n); END IF;
 END LOOP;
 RETURN counts;
END $$;

CREATE FUNCTION public.admin_deletion_blockers(p_request uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.account_deletion_requests; blockers text[]; ids uuid[]; emails text[]; c record; n bigint;
 known_tables text[]:=ARRAY['hub_user_profiles','hub_user_saved_merchants','merchant_verified_visit_helpful_reactions',
 'merchant_verified_visit_reports','hub_notification_preferences','web_push_deliveries','web_push_subscriptions',
 'native_push_deliveries','hub_user_devices','web_push_jobs','wallet_link_challenges','hub_user_wallets',
 'merchant_visit_photos','photo_processing_jobs','merchant_discovery_contributions','merchant_discovery_item_mentions',
 'discovery_contribution_requests','miles_spend_intents','miles_ledger_holds','voucher_redemptions','voucher_purchase_quotes',
 'verified_earning_events','hub_quest_action_proofs','issued_vouchers','voucher_claim_intents','hub_user_risk_flags',
 'identity_merge_incidents','hub_identity_reconciliation_failures','hub_profile_country_audit','hub_referrals',
 'referral_reward_jobs','hub_referral_codes','hub_user_passes','miles_earned_notification_outbox','notification_outbox',
 'account_deletion_challenges','hub_user_canonicals'];
BEGIN
 SELECT * INTO r FROM public.account_deletion_requests WHERE id=p_request;
 IF NOT FOUND OR r.hub_user_id IS NULL THEN RETURN ARRAY['request_unavailable']; END IF;
 IF r.policy_version<>'2026-10-19.3' THEN RETURN ARRAY['policy_reconfirmation_required']; END IF;
 IF r.status NOT IN ('manual_review','processing') THEN RETURN ARRAY['request_not_eligible']; END IF;
 IF r.status='processing' AND NOT EXISTS(SELECT 1 FROM public.account_deletion_admin_cases WHERE request_id=r.id) THEN RETURN ARRAY['automated_request_in_progress']; END IF;
 -- Only the human-approved scope exclusion is superseded. Financial/history
 -- and in-flight blockers remain. Alias ownership is rechecked below.
 blockers:=array_remove(public.account_deletion_preflight(r.hub_user_id),'shared_account_scope_review');
 ids:=public.account_deletion_canonicals(r.hub_user_id);
 emails:=ARRAY(SELECT lower(btrim(email)) FROM auth.users WHERE id=r.hub_user_id
  UNION SELECT lower(btrim(identity_value)) FROM public.identity_links WHERE canonical_id=ANY(ids) AND identity_type='email');
 IF NOT EXISTS(SELECT 1 FROM public.hub_user_canonicals WHERE canonical_id=ANY(ids) AND hub_user_id<>r.hub_user_id)
  AND NOT EXISTS(SELECT 1 FROM public.identity_links WHERE canonical_id=ANY(ids) AND identity_type<>'email')
  AND NOT EXISTS(SELECT 1 FROM auth.users a JOIN public.identity_links l ON lower(btrim(a.email))=lower(btrim(l.identity_value))
    WHERE l.canonical_id=ANY(ids) AND l.identity_type='email' AND a.id<>r.hub_user_id) THEN
   blockers:=array_remove(blockers,'shared_canonical_identity');
 END IF;
 -- Notes are arbitrary text on immutable ledger rows; do not pretend removing
 -- identity_links removes identifiers embedded in a note or transaction hash.
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='miles_ledger'
  AND column_name NOT IN ('id','canonical_id','amount','direction','source_type','source_id','partner_id','on_chain','tx_hash','note','created_at') LOOP
  EXECUTE format('SELECT count(*) FROM public.miles_ledger WHERE canonical_id=ANY($1) AND %I IS NOT NULL',c.column_name) INTO n USING ids;
  IF n>0 THEN blockers:=array_append(blockers,'ledger_schema_review_required'); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.miles_ledger WHERE canonical_id=ANY(ids) AND (note IS NOT NULL OR tx_hash IS NOT NULL)) THEN
  blockers:=array_append(blockers,'ledger_payload_review_required');
 END IF;
 FOR c IN SELECT key FROM jsonb_each(public.admin_deletion_member_counts(r.hub_user_id)) LOOP
  IF split_part(c.key,'.',1)<>ALL(known_tables) THEN blockers:=array_append(blockers,'unhandled_member_table:'||split_part(c.key,'.',1)); END IF;
 END LOOP;
 -- Pending Miles are member rewards, not payment evidence. All other direct
 -- email histories remain an exception for the operator to resolve separately.
 blockers:=array_remove(blockers,'shared_identity_history');
 FOR c IN SELECT col.table_name,col.column_name FROM information_schema.columns col JOIN information_schema.tables t USING(table_schema,table_name)
  WHERE col.table_schema='public' AND t.table_type='BASE TABLE' AND col.column_name IN ('email','user_email','identity_value')
    AND col.table_name NOT IN ('identity_links','pending_miles','hub_user_profiles')
 LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE lower(btrim(%I::text))=ANY($1)',c.table_name,c.column_name) INTO n USING emails;
  IF n>0 THEN blockers:=array_append(blockers,'contact_history_review:'||c.table_name); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.merchant_visit_photos a JOIN public.merchant_visit_photos b
   ON b.hub_user_id<>a.hub_user_id AND (b.private_source_key=a.private_source_key
    OR array_remove(ARRAY[b.thumbnail_key,b.display_key],NULL) && array_remove(ARRAY[a.thumbnail_key,a.display_key],NULL))
   WHERE a.hub_user_id=r.hub_user_id) THEN blockers:=array_append(blockers,'shared_storage_reference'); END IF;
 IF EXISTS(SELECT 1 FROM storage.objects o WHERE COALESCE(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=r.hub_user_id::text
   AND bucket_id NOT IN ('discovery-visit-photos','discovery-visit-photos-derived')) THEN
  blockers:=array_append(blockers,'other_storage_policy_required');
 END IF;
 RETURN ARRAY(SELECT DISTINCT b FROM unnest(blockers) b ORDER BY b);
END $$;

CREATE FUNCTION public.assign_admin_account_deletion(p_request uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.account_deletion_requests;
BEGIN
 PERFORM public.require_deletion_operator(p_actor);
 SELECT * INTO r FROM public.account_deletion_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('manual_review','processing') THEN RAISE EXCEPTION 'request unavailable' USING ERRCODE='55000'; END IF;
 IF r.status='processing' AND NOT EXISTS(SELECT 1 FROM public.account_deletion_admin_cases WHERE request_id=p_request) THEN RAISE EXCEPTION 'automated request' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_deletion_admin_cases WHERE request_id=p_request AND lease_until>now()) THEN RAISE EXCEPTION 'request busy' USING ERRCODE='55000'; END IF;
 INSERT INTO public.account_deletion_admin_cases(request_id,assignee) VALUES(p_request,p_actor)
 ON CONFLICT(request_id) DO UPDATE SET assignee=p_actor,updated_at=now();
 INSERT INTO public.account_deletion_events(request_id,event_type,actor_kind,metadata)
 VALUES(p_request,'admin_assigned','operator',jsonb_build_object('actor',p_actor));
END $$;

CREATE FUNCTION public.begin_admin_account_deletion(p_request uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.account_deletion_requests; c public.account_deletion_admin_cases; blockers text[]; token uuid:=gen_random_uuid(); manifest jsonb;
BEGIN
 PERFORM public.require_deletion_operator(p_actor);
 SELECT * INTO r FROM public.account_deletion_requests WHERE id=p_request FOR UPDATE;
 SELECT * INTO c FROM public.account_deletion_admin_cases WHERE request_id=p_request FOR UPDATE;
 IF c.assignee IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('ok',false,'blockers',ARRAY['assignment_required']); END IF;
 IF r.status='completed' THEN RETURN jsonb_build_object('ok',true,'completed',true); END IF;
 IF c.lease_until>now() THEN RETURN jsonb_build_object('ok',false,'blockers',ARRAY['request_busy']); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('account_deletion:'||r.hub_user_id::text));
 blockers:=public.admin_deletion_blockers(p_request);
 IF cardinality(blockers)>0 THEN RETURN jsonb_build_object('ok',false,'blockers',blockers); END IF;
 UPDATE public.account_deletion_requests SET status='processing',processing_started_at=COALESCE(processing_started_at,now()),
  lease_expires_at='infinity',next_retry_at=NULL WHERE id=p_request;
 -- Preserve the manifest across retries, even if an earlier Storage call
 -- succeeded before its response was lost. Database rows still exist until finalization.
 SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('bucket',bucket,'key',key)),'[]') INTO manifest FROM (
  SELECT 'discovery-visit-photos' AS bucket,private_source_key AS key FROM public.merchant_visit_photos WHERE hub_user_id=r.hub_user_id
  UNION SELECT 'discovery-visit-photos-derived',thumbnail_key FROM public.merchant_visit_photos WHERE hub_user_id=r.hub_user_id
  UNION SELECT 'discovery-visit-photos-derived',display_key FROM public.merchant_visit_photos WHERE hub_user_id=r.hub_user_id
  UNION SELECT bucket_id,name FROM storage.objects o WHERE COALESCE(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=r.hub_user_id::text
   AND bucket_id IN ('discovery-visit-photos','discovery-visit-photos-derived')
  UNION SELECT item->>'bucket',item->>'key' FROM jsonb_array_elements(c.storage_manifest) item
 ) entries WHERE key IS NOT NULL;
 UPDATE public.account_deletion_admin_cases SET state='running',run_token=token,lease_until=now()+interval '15 minutes',
  failure_code=NULL,storage_manifest=manifest,updated_at=now() WHERE request_id=p_request;
 INSERT INTO public.account_deletion_events(request_id,event_type,actor_kind,metadata)
 VALUES(p_request,'admin_cleanup_started','operator',jsonb_build_object('actor',p_actor,'objects',jsonb_array_length(manifest)));
 RETURN jsonb_build_object('ok',true,'runToken',token);
END $$;

CREATE FUNCTION public.admin_deletion_storage_page(p_request uuid,p_actor uuid,p_token uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manifest jsonb;
BEGIN
 PERFORM public.require_deletion_operator(p_actor);
 SELECT storage_manifest INTO manifest FROM public.account_deletion_admin_cases
 WHERE request_id=p_request AND assignee=p_actor AND run_token=p_token AND state='running' AND lease_until>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'execution lease unavailable' USING ERRCODE='55000'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(manifest) WITH ORDINALITY e(value,n)
 WHERE n>greatest(p_offset,0) AND n<=greatest(p_offset,0)+100),'[]');
END $$;

CREATE FUNCTION public.fail_admin_account_deletion(p_request uuid,p_actor uuid,p_token uuid,p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.require_deletion_operator(p_actor);
 IF p_code NOT IN ('storage_cleanup_failed','database_cleanup_failed','verification_failed','unexpected_failure') THEN RAISE EXCEPTION 'invalid failure code'; END IF;
 UPDATE public.account_deletion_admin_cases SET state='failed',lease_until=NULL,failure_code=p_code,updated_at=now()
 WHERE request_id=p_request AND assignee=p_actor AND run_token=p_token AND state='running';
 IF FOUND THEN
  INSERT INTO public.account_deletion_events(request_id,event_type,actor_kind,metadata)
  VALUES(p_request,'admin_cleanup_failed','operator',jsonb_build_object('actor',p_actor,'reason',p_code));
 END IF;
END $$;

CREATE FUNCTION public.finalize_admin_account_deletion(p_request uuid,p_actor uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.account_deletion_requests; c public.account_deletion_admin_cases; blockers text[]; ids uuid[]; emails text[]; step text; finish record; counts jsonb; device_ids uuid[]; subscription_ids uuid[];
BEGIN
 PERFORM public.require_deletion_operator(p_actor);
 SELECT * INTO r FROM public.account_deletion_requests WHERE id=p_request FOR UPDATE;
 SELECT * INTO c FROM public.account_deletion_admin_cases WHERE request_id=p_request FOR UPDATE;
 IF r.status='completed' AND c.state='verified' THEN RETURN jsonb_build_object('ok',true,'alreadyCompleted',true); END IF;
 IF c.assignee IS DISTINCT FROM p_actor OR c.run_token IS DISTINCT FROM p_token OR c.state<>'running' OR c.lease_until<=now() THEN
  RAISE EXCEPTION 'execution lease unavailable' USING ERRCODE='55000';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('account_deletion:'||r.hub_user_id::text));
 blockers:=public.admin_deletion_blockers(p_request);
 IF cardinality(blockers)>0 THEN RETURN jsonb_build_object('ok',false,'blockers',blockers); END IF;
 -- Metadata check after Storage API removal, never SQL-delete Storage objects.
 IF EXISTS(SELECT 1 FROM storage.objects o JOIN jsonb_array_elements(c.storage_manifest) m
  ON o.bucket_id=m->>'bucket' AND o.name=m->>'key') OR EXISTS(SELECT 1 FROM storage.objects o
  WHERE COALESCE(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=r.hub_user_id::text) THEN
  RETURN jsonb_build_object('ok',false,'blockers',ARRAY['storage_verification_failed']);
 END IF;
 ids:=public.account_deletion_canonicals(r.hub_user_id);
 emails:=ARRAY(SELECT lower(btrim(email)) FROM auth.users WHERE id=r.hub_user_id
  UNION SELECT lower(btrim(identity_value)) FROM public.identity_links WHERE canonical_id=ANY(ids) AND identity_type='email');
 PERFORM set_config('akiba.deletion_request',p_request::text,true);
 -- Non-RPC worker steps, in FK order, in this same transaction.
 DELETE FROM public.hub_user_saved_merchants WHERE hub_user_id=r.hub_user_id;
 DELETE FROM public.merchant_verified_visit_helpful_reactions WHERE hub_user_id=r.hub_user_id;
 DELETE FROM public.merchant_verified_visit_reports WHERE reporter_hub_user_id=r.hub_user_id;
 DELETE FROM public.hub_notification_preferences WHERE hub_user_id=r.hub_user_id;
 subscription_ids:=ARRAY(SELECT id FROM public.web_push_subscriptions WHERE hub_user_id=r.hub_user_id);
 device_ids:=ARRAY(SELECT id FROM public.hub_user_devices WHERE hub_user_id=r.hub_user_id);
 DELETE FROM public.web_push_deliveries WHERE subscription_id=ANY(subscription_ids);
 DELETE FROM public.native_push_deliveries WHERE device_id=ANY(device_ids);
 DELETE FROM public.web_push_jobs WHERE hub_user_id=r.hub_user_id;
 DELETE FROM public.web_push_subscriptions WHERE hub_user_id=r.hub_user_id;
 DELETE FROM public.hub_user_devices WHERE hub_user_id=r.hub_user_id;
 FOREACH step IN ARRAY ARRAY['published_photos','unpublished_contributions','wallet_links','reward_ledger','settlement_evidence',
 'earning_events','skill_game_prizes','active_vouchers','fraud_risk','referrals','pass_credentials','notification_history','shared_profile_projection'] LOOP
  PERFORM public.execute_account_deletion_step(p_request,step);
  INSERT INTO public.account_deletion_events(request_id,event_type,actor_kind,metadata)
   VALUES(p_request,'step_completed','operator',jsonb_build_object('step',step,'actor',p_actor));
 END LOOP;
 DELETE FROM public.hub_user_profiles WHERE user_id=r.hub_user_id;
 INSERT INTO public.account_deletion_evidence(request_id,category,payload)
 SELECT p_request,'rewards',jsonb_build_object('kind','pending_miles','amount',amount,'occurred_at',created_at)
 FROM public.pending_miles WHERE identity_type='email' AND lower(btrim(identity_value))=ANY(emails);
 DELETE FROM public.pending_miles WHERE identity_type='email' AND lower(btrim(identity_value))=ANY(emails);
 DELETE FROM public.account_deletion_challenges WHERE hub_user_id=r.hub_user_id;
 DELETE FROM public.identity_links WHERE canonical_id=ANY(ids);
 DELETE FROM public.hub_user_canonicals WHERE hub_user_id=r.hub_user_id;
 -- Verify owned rows/projections before dropping the last Auth link. An
 -- exception rolls ALL database cleanup, evidence and step events back.
 counts:=public.admin_deletion_member_counts(r.hub_user_id);
 IF counts<>'{}' OR EXISTS(SELECT 1 FROM public.identity_links WHERE canonical_id=ANY(ids))
   OR EXISTS(SELECT 1 FROM public.leaderboard_profiles WHERE canonical_id=ANY(ids))
   OR EXISTS(SELECT 1 FROM public.leaderboard_username_changes WHERE canonical_id=ANY(ids)) THEN
  RAISE EXCEPTION 'cleanup verification failed' USING ERRCODE='55000';
 END IF;
 -- Older cancelled receipts must not retain an Auth FK or contact indefinitely.
 UPDATE public.account_deletion_requests SET hub_user_id=NULL,completion_contact_ciphertext=NULL,
  completion_contact_key_version=NULL,evidence_expires_at=COALESCE(evidence_expires_at,now()+interval '24 months')
  WHERE hub_user_id=r.hub_user_id AND id<>p_request;
 PERFORM public.execute_account_deletion_step(p_request,'auth_identity');
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=r.hub_user_id) THEN RAISE EXCEPTION 'auth verification failed'; END IF;
 INSERT INTO public.account_deletion_events(request_id,event_type,actor_kind,metadata)
 VALUES(p_request,'cleanup_verified','operator',jsonb_build_object('actor',p_actor,'scope','shared_account','remainingOwnedRows',0,'remainingStorageObjects',0,'authRemoved',true));
 UPDATE public.account_deletion_admin_cases SET state='verified',verified_at=now(),lease_until=NULL,run_token=NULL,storage_manifest='[]',failure_code=NULL,updated_at=now() WHERE request_id=p_request;
 SELECT * INTO finish FROM public.finish_account_deletion_request(p_request,'completed',NULL);
 IF NOT finish.ok THEN RAISE EXCEPTION 'completion refused'; END IF;

 RETURN jsonb_build_object('ok',true,'verified',true);
END $$;

-- Disable the former procedural mark-complete escape hatch.
CREATE OR REPLACE FUNCTION public.complete_manual_account_deletion_request(p_request_id uuid,p_actor text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'use verified admin fulfilment' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION public.complete_manual_account_deletion_request(uuid,text) FROM service_role;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('require_deletion_operator','admin_deletion_member_counts','admin_deletion_blockers','assign_admin_account_deletion',
 'begin_admin_account_deletion','admin_deletion_storage_page','fail_admin_account_deletion','finalize_admin_account_deletion') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;

-- Freeze shared identity/ledger writes only during actual cleanup, not while a
-- request is waiting for assignment. This prevents source jobs recreating rows
-- between preflight and final verification.
CREATE FUNCTION public.guard_admin_deletion_identity_writes() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE u uuid; candidate text; candidates text[]; ctx text:=current_setting('akiba.deletion_request',true);
BEGIN
 candidates:=ARRAY[to_jsonb(NEW)->>'hub_user_id',to_jsonb(NEW)->>'user_id'];
 IF to_jsonb(NEW)->>'canonical_id' IS NOT NULL THEN
  candidates:=candidates || ARRAY(SELECT hub_user_id::text FROM public.hub_user_canonicals WHERE canonical_id::text=to_jsonb(NEW)->>'canonical_id');
 END IF;
 IF to_jsonb(NEW)->>'identity_type'='email' THEN
  candidates:=candidates || ARRAY(SELECT id::text FROM auth.users WHERE lower(btrim(email))=lower(btrim(to_jsonb(NEW)->>'identity_value')));
 END IF;
 FOREACH candidate IN ARRAY candidates LOOP
  IF candidate IS NULL THEN CONTINUE; END IF;
  u:=candidate::uuid;
  PERFORM pg_advisory_xact_lock(hashtext('account_deletion:'||u::text));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests r WHERE r.hub_user_id=u AND r.status='processing')
   AND NOT (current_user=pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.finalize_admin_account_deletion(uuid,uuid,uuid)'::regprocedure))
    AND EXISTS(SELECT 1 FROM public.account_deletion_requests r WHERE r.id::text=ctx AND r.hub_user_id=u AND r.status='processing')) THEN
   RAISE EXCEPTION 'account deletion in progress' USING ERRCODE='55000';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['identity_links','pending_miles','miles_ledger','hub_user_canonicals','leaderboard_profiles','leaderboard_username_changes'] LOOP
  EXECUTE format('CREATE TRIGGER guard_admin_deletion_writes BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_admin_deletion_identity_writes()',t);
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';

CREATE FUNCTION public.require_verified_admin_deletion_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
  AND (OLD.status='manual_review' OR EXISTS(SELECT 1 FROM public.account_deletion_admin_cases WHERE request_id=NEW.id)
   OR EXISTS(SELECT 1 FROM public.account_deletion_events WHERE request_id=NEW.id AND event_type='manual_review_queued'))
  AND NOT EXISTS(SELECT 1 FROM public.account_deletion_admin_cases WHERE request_id=NEW.id AND state='verified' AND verified_at IS NOT NULL) THEN
  RAISE EXCEPTION 'verified cleanup required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_completion_requires_verification BEFORE UPDATE ON public.account_deletion_requests
 FOR EACH ROW EXECUTE FUNCTION public.require_verified_admin_deletion_completion();

CREATE FUNCTION public.claim_admin_deletion_completion_email(p_request uuid)
RETURNS SETOF public.account_deletion_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN QUERY WITH candidate AS (
  SELECT id FROM public.account_deletion_requests WHERE id=p_request AND status='completed'
   AND completion_email_sent_at IS NULL AND completion_contact_ciphertext IS NOT NULL
   AND completion_contact_expires_at>now()
   AND (completion_email_next_retry_at IS NULL OR completion_email_next_retry_at<=now())
   AND (completion_email_lease_expires_at IS NULL OR completion_email_lease_expires_at<=now()) FOR UPDATE SKIP LOCKED
 ) UPDATE public.account_deletion_requests r SET completion_email_attempts=r.completion_email_attempts+1,
   completion_email_lease_expires_at=now()+interval '5 minutes',completion_email_next_retry_at=NULL
 FROM candidate WHERE r.id=candidate.id RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_admin_deletion_completion_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_deletion_completion_email(uuid) TO service_role;

CREATE FUNCTION public.admin_deletion_fulfilment_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.admin_users WHERE is_active AND role::text IN ('super_admin','ops_admin'));
$$;
REVOKE ALL ON FUNCTION public.admin_deletion_fulfilment_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deletion_fulfilment_ready() TO service_role;

-- Application writes use definer RPCs. The REST service client cannot edit
-- request status or policy_version to bypass verified manual completion.
REVOKE INSERT,UPDATE ON public.account_deletion_requests FROM service_role;
