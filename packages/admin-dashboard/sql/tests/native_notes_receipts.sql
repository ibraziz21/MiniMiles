-- Run after submit_publish.sql in a disposable local database.
CREATE TABLE admin_users(id uuid PRIMARY KEY);
CREATE TABLE hub_notification_preferences(hub_user_id uuid,marketing_enabled boolean);
CREATE TABLE web_push_subscriptions(id uuid,hub_user_id uuid,status text);
CREATE TABLE hub_user_devices(id uuid,hub_user_id uuid,status text,expo_push_token text);
CREATE TABLE web_push_campaigns(id uuid PRIMARY KEY,campaign_type text,title text,body text,deep_link text,status text,audience_count integer,queued_count integer,created_by text,created_at timestamptz);
CREATE TABLE notification_outbox(id uuid,campaign_id uuid);
CREATE TABLE web_push_jobs(id uuid,notification_id uuid,status text);
CREATE TABLE web_push_deliveries(id uuid,job_id uuid,status text);
CREATE TABLE native_push_deliveries(id uuid,job_id uuid,status text);
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
\ir ../024_native_campaign_audience.sql
\ir ../025_merchant_support_notes.sql
\ir ../026_reimbursement_evidence.sql
DO $$
DECLARE a uuid:='11111111-1111-4111-8111-111111111111'; b uuid:='22222222-2222-4222-8222-222222222222';
BEGIN
 INSERT INTO hub_notification_preferences VALUES(a,true),(b,false);
 INSERT INTO hub_user_devices VALUES(a,a,'active','ExpoPushToken[test]'),(b,b,'active','ExpoPushToken[optout]');
 IF (SELECT count(*) FROM v_web_push_marketing_audience)<>1 OR (SELECT active_device_count FROM v_web_push_marketing_audience WHERE hub_user_id=a)<>1 THEN RAISE EXCEPTION 'Native audience opt-in failed'; END IF;
 INSERT INTO web_push_subscriptions VALUES(a,a,'active');
 IF (SELECT count(*) FROM v_web_push_marketing_audience)<>1 OR (SELECT active_device_count FROM v_web_push_marketing_audience WHERE hub_user_id=a)<>2 THEN RAISE EXCEPTION 'Audience duplicate users'; END IF;
 INSERT INTO web_push_campaigns(id)VALUES(a);INSERT INTO notification_outbox VALUES(a,a);INSERT INTO web_push_jobs VALUES(a,a,'completed');INSERT INTO web_push_deliveries VALUES(a,a,'accepted');INSERT INTO native_push_deliveries VALUES(b,a,'accepted');
 IF (SELECT accepted_deliveries FROM v_web_push_campaign_delivery_stats WHERE id=a)<>2 THEN RAISE EXCEPTION 'Native acceptance missing'; END IF;
 IF has_table_privilege('anon','merchant_admin_notes','SELECT') OR has_table_privilege('authenticated','merchant_admin_notes','INSERT') THEN RAISE EXCEPTION 'Notes exposed'; END IF;
 IF (SELECT public FROM storage.buckets WHERE id='voucher-reimbursement-evidence') THEN RAISE EXCEPTION 'Receipt bucket is public'; END IF;
 RAISE NOTICE 'Native opt-in, unique recipients, acceptance, notes permissions and private receipt bucket passed';
END; $$;
