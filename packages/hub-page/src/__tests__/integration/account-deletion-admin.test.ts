import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const migrations = resolve(__dirname, "../../../../../supabase/migrations");
const read = (name: string) => readFileSync(resolve(migrations, name), "utf8");
// Use real CREATE TABLE bodies so FKs, NOT NULL and CHECKs are exercised.
function table(file: string, name: string) {
  const match = read(file).match(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${name} \\([\\s\\S]*?\\n\\);`, "i"));
  if (!match) throw new Error(`Missing schema: ${name}`);
  return match[0];
}
const cfg = {
  host: process.env.PG_HOST ?? "127.0.0.1", port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER, password: process.env.PG_PASSWORD ?? "",
};
const db = `akiba_admin_${process.pid}`;
const admin = new pg.Pool({ ...cfg, database: "postgres" });
const sql = new pg.Pool({ ...cfg, database: db });

beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${db}`);
  await sql.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text);
    CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE TABLE partners(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE spend_voucher_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE issued_vouchers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hub_user_id uuid REFERENCES auth.users,
      status text DEFAULT 'issued',redemption_token_hash text,created_at timestamptz DEFAULT now());
    CREATE TABLE voucher_programs(id uuid PRIMARY KEY);
    CREATE TABLE minipoint_burn_jobs(id uuid PRIMARY KEY);
    CREATE TABLE referral_program_versions(id uuid PRIMARY KEY);
    CREATE TABLE discovery_question_templates(id uuid PRIMARY KEY);
    CREATE TABLE merchant_discovery_items(id uuid PRIMARY KEY);
    CREATE TABLE skill_game_leaderboard_settlements(id uuid PRIMARY KEY);
    CREATE TABLE skill_game_sessions(session_id text PRIMARY KEY);
    CREATE TABLE hub_user_canonicals(hub_user_id uuid PRIMARY KEY,canonical_id uuid NOT NULL);
    CREATE TABLE hub_quest_action_proofs(hub_user_id uuid);
    CREATE TABLE notification_outbox(hub_user_id uuid);
    CREATE TABLE hub_user_passes(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users);
  `);
  await sql.query(read("097_account_deletion_workflow.sql"));
  // Pinned copy of Akiba-Platform 003: ledger CHECKs and immutable trigger.
  await sql.query(readFileSync(resolve(__dirname,"fixtures/platform-rewards.sql"),"utf8"));
  for (const [file, names] of [
    ["001_voucher_platform_phase1.sql", ["mpesa_stk_requests", "voucher_redemptions", "voucher_events", "reconciliation_incidents"]],
    ["005_voucher_settlement_phase4.sql", ["voucher_settlement_entries"]],
    ["046_hub_miles_spend_intents.sql", ["voucher_purchase_quotes", "miles_spend_intents", "miles_ledger_holds"]],
    ["053_referral_system.sql", ["hub_referral_codes", "referral_clicks", "hub_referrals", "referral_reward_jobs", "referral_events", "hub_user_risk_flags"]],
    ["081_verified_discovery_core.sql", ["verified_earning_events", "discovery_contribution_requests", "merchant_discovery_contributions", "merchant_discovery_item_mentions", "merchant_discovery_contribution_items"]],
    ["082_verified_discovery_photos.sql", ["merchant_visit_photos", "photo_processing_jobs"]],
    ["083_verified_earning_status_changes.sql", ["verified_earning_event_status_changes"]],
    ["090_verified_discovery_hardening.sql", ["discovery_moderation_audit_events"]],
    ["100_verified_visit_browsing_actions.sql", ["merchant_verified_visit_helpful_reactions"]],
    ["051_verified_wallet_linking.sql", ["identity_merge_incidents"]],
    ["094_funded_voucher_profile_country_eligibility.sql", ["hub_profile_country_audit"]],
    ["099_hub_auth_purchase_identity_bridge.sql", ["hub_identity_reconciliation_failures"]],
    ["068_skill_game_dormant_prize_schema.sql", ["skill_game_leaderboard_prize_deliveries"]],
    ["077_voucher_claim_intents.sql", ["voucher_claim_intents"]],
  ] as const) for (const name of names) await sql.query(table(file, name));
  // Retain the real append-only trigger semantics, replaced narrowly by 103.
  await sql.query(`CREATE FUNCTION reject_discovery_moderation_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$;
    CREATE TRIGGER trg_discovery_moderation_audit_no_mutation BEFORE UPDATE OR DELETE ON discovery_moderation_audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_discovery_moderation_audit_mutation();`);
  await sql.query(read("103_account_deletion_evidence.sql"));
  await sql.query(`
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,PRIMARY KEY(bucket_id,name));
    CREATE TABLE admin_users(id uuid PRIMARY KEY,is_active boolean NOT NULL,role text,email text);
    CREATE TABLE hub_user_profiles(user_id uuid PRIMARY KEY REFERENCES auth.users,email text);
    CREATE TABLE hub_user_saved_merchants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hub_user_id uuid REFERENCES auth.users);
    CREATE TABLE hub_notification_preferences(hub_user_id uuid REFERENCES auth.users);
    CREATE TABLE web_push_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hub_user_id uuid REFERENCES auth.users);
    CREATE TABLE web_push_deliveries(subscription_id uuid REFERENCES web_push_subscriptions);
    CREATE TABLE web_push_jobs(hub_user_id uuid REFERENCES auth.users);
    CREATE TABLE hub_user_devices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hub_user_id uuid REFERENCES auth.users);
    CREATE TABLE native_push_deliveries(device_id uuid REFERENCES hub_user_devices);
    CREATE TABLE wallet_link_challenges(hub_user_id uuid REFERENCES auth.users);
    CREATE TABLE hub_user_wallets(user_id uuid REFERENCES auth.users,address text);
    CREATE TABLE leaderboard_profiles(canonical_id uuid PRIMARY KEY,username text);
    CREATE TABLE leaderboard_username_changes(canonical_id uuid,username text);
    CREATE TABLE auth.sessions(user_id uuid REFERENCES auth.users ON DELETE CASCADE);
    CREATE TABLE auth.identities(user_id uuid REFERENCES auth.users ON DELETE CASCADE);
  `);
  await sql.query(read("104_verified_visit_reports.sql"));
  await sql.query(read("105_account_deletion_shared_identity_steps.sql"));
  await sql.query(read("106_account_deletion_manual_fulfilment.sql"));
  await sql.query(read("108_admin_account_deletion_fulfilment.sql"));
});


afterAll(async () => { await sql.end(); await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); await admin.end(); });
const operator=randomUUID(),otherOperator=randomUUID();
async function fixture(version="2026-10-19.3",withPhoto=false) {
 await sql.query("INSERT INTO admin_users(id,is_active,role,email) VALUES($1,true,'ops_admin','staff@example.invalid'),($2,true,'ops_admin','backup@example.invalid') ON CONFLICT DO NOTHING",[operator,otherOperator]);
 const user=randomUUID(),id=randomUUID(),canonical=randomUUID(),email=`${user}@example.invalid`;
 await sql.query("INSERT INTO auth.users VALUES($1,$2)",[user,email]);
 await sql.query("INSERT INTO auth.sessions VALUES($1)",[user]);
 await sql.query("INSERT INTO auth.identities VALUES($1)",[user]);
 await sql.query("INSERT INTO hub_user_profiles VALUES($1,$2)",[user,email]);
 await sql.query("INSERT INTO hub_user_canonicals VALUES($1,$2)",[user,canonical]);
 await sql.query("INSERT INTO identity_links(canonical_id,identity_type,identity_value) VALUES($1,'email',$2)",[canonical,email]);
 await sql.query("INSERT INTO miles_ledger(canonical_id,amount,direction,source_type) VALUES($1,100,'credit','merchant')",[canonical]);
 await sql.query("INSERT INTO hub_user_wallets VALUES($1,'wallet-placeholder')",[user]);
 await sql.query("INSERT INTO leaderboard_profiles VALUES($1,'member')",[canonical]);
 await sql.query("INSERT INTO leaderboard_username_changes VALUES($1,'old-member')",[canonical]);
 await sql.query("INSERT INTO hub_user_saved_merchants(hub_user_id) VALUES($1)",[user]);
 await sql.query("INSERT INTO hub_notification_preferences VALUES($1)",[user]);
 const subscription=(await sql.query("INSERT INTO web_push_subscriptions(hub_user_id) VALUES($1) RETURNING id",[user])).rows[0].id;
 await sql.query("INSERT INTO web_push_deliveries VALUES($1)",[subscription]);
 const device=(await sql.query("INSERT INTO hub_user_devices(hub_user_id) VALUES($1) RETURNING id",[user])).rows[0].id;
 await sql.query("INSERT INTO native_push_deliveries VALUES($1)",[device]);
 if(withPhoto) {
  const partner=randomUUID(),template=randomUUID(),earning=randomUUID(),draft=randomUUID(),contribution=randomUUID(),photo=randomUUID();
  await sql.query("INSERT INTO partners VALUES($1)",[partner]);await sql.query("INSERT INTO discovery_question_templates VALUES($1)",[template]);
  await sql.query("INSERT INTO verified_earning_events(id,event_id,hub_user_id,partner_id,source,occurred_at) VALUES($1,$2,$3,$4,'merchant_scan',now())",[earning,randomUUID(),user,partner]);
  await sql.query("INSERT INTO discovery_contribution_requests(id,earning_event_id,hub_user_id,partner_id,template_id,template_version,template_snapshot,expires_at) VALUES($1,$2,$3,$4,$5,1,'{}',now()+interval '1 day')",[draft,earning,user,partner,template]);
  await sql.query("INSERT INTO merchant_discovery_contributions(id,request_id,hub_user_id,partner_id,would_recommend) VALUES($1,$2,$3,$4,true)",[contribution,draft,user,partner]);
  await sql.query("INSERT INTO merchant_visit_photos(id,contribution_id,hub_user_id,partner_id,private_source_key,consent_version) VALUES($1,$2,$3,$4,$5,'notice')",[photo,contribution,user,partner,user+'/source.jpg']);
  await sql.query("INSERT INTO discovery_moderation_audit_events(photo_id,actor_id,action,reason_code,before_status,after_status) VALUES($1,'moderator','approve','quality_ok','pending','approved')",[photo]);
  await sql.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('discovery-visit-photos',$1,$2)",[user+'/source.jpg',user]);
  await sql.query("INSERT INTO pending_miles(identity_type,identity_value,amount,source_type,source_id,partner_id) VALUES('email',$1,50,'merchant',$2,$3)",[email,randomUUID(),partner]);
 }
 await sql.query("INSERT INTO account_deletion_requests(id,hub_user_id,status,source,policy_version,target_completion_at,completion_contact_ciphertext,completion_contact_key_version) VALUES($1,$2,'manual_review','native_android',$3,now()+interval '14 days',decode('aa','hex'),'v1')",[id,user,version]);
 return {id,user,canonical,email};
}
async function assign(id:string,actor=operator){await sql.query("SELECT assign_admin_account_deletion($1,$2)",[id,actor]);}
async function begin(id:string,actor=operator){return (await sql.query("SELECT begin_admin_account_deletion($1,$2) result",[id,actor])).rows[0].result;}
async function finalize(id:string,token:string,actor=operator){return (await sql.query("SELECT finalize_admin_account_deletion($1,$2,$3) result",[id,actor,token])).rows[0].result;}
describe("admin-directed shared account deletion",()=>{
 it("erases a complete disposable member and sessions, preserving only unmapped immutable ledger and dated proof",async()=>{
  const a=await fixture(),b=await fixture();await assign(a.id);
  expect((await sql.query("SELECT admin_deletion_blockers($1) b",[a.id])).rows[0].b).toEqual([]);
  const started=await begin(a.id);expect(started.ok).toBe(true);
  expect(await finalize(a.id,started.runToken)).toEqual({ok:true,verified:true});
  expect((await sql.query("SELECT count(*)::int n FROM auth.users WHERE id=$1",[a.user])).rows[0].n).toBe(0);
  expect((await sql.query("SELECT count(*)::int n FROM auth.sessions WHERE user_id=$1",[a.user])).rows[0].n).toBe(0);
  expect((await sql.query("SELECT admin_deletion_member_counts($1) counts",[a.user])).rows[0].counts).toEqual({});
  expect((await sql.query("SELECT count(*)::int n FROM identity_links WHERE canonical_id=$1",[a.canonical])).rows[0].n).toBe(0);
  expect((await sql.query("SELECT count(*)::int n FROM miles_ledger WHERE canonical_id=$1",[a.canonical])).rows[0].n).toBe(1);
  expect((await sql.query("SELECT count(*)::int n FROM auth.users WHERE id=$1",[b.user])).rows[0].n).toBe(1);
  const proof=(await sql.query("SELECT status,hub_user_id,evidence_expires_at=completed_at+interval '24 months' clock FROM account_deletion_requests WHERE id=$1",[a.id])).rows[0];
  expect(proof).toEqual({status:'completed',hub_user_id:null,clock:true});
  expect((await sql.query("SELECT state,storage_manifest,run_token FROM account_deletion_admin_cases WHERE request_id=$1",[a.id])).rows[0]).toEqual({state:'verified',storage_manifest:[],run_token:null});
  expect(await finalize(a.id,started.runToken)).toMatchObject({ok:true,alreadyCompleted:true});
 });
 it("removes actual photo rows, source queues and pending rewards with minimal dated evidence",async()=>{const a=await fixture('2026-10-19.3',true);await assign(a.id);const start=await begin(a.id);expect(start.ok).toBe(true);expect(await finalize(a.id,start.runToken)).toMatchObject({ok:false,blockers:['storage_verification_failed']});await sql.query("DELETE FROM storage.objects WHERE owner_id=$1",[a.user]);expect(await finalize(a.id,start.runToken)).toMatchObject({ok:true});expect((await sql.query("SELECT count(*)::int n FROM merchant_visit_photos WHERE hub_user_id=$1",[a.user])).rows[0].n).toBe(0);expect((await sql.query("SELECT count(*)::int n FROM pending_miles WHERE identity_value=$1",[a.email])).rows[0].n).toBe(0);const retained=(await sql.query("SELECT category,payload,expires_at FROM account_deletion_evidence WHERE request_id=$1",[a.id])).rows;expect(retained.some(e=>e.category==='moderation')).toBe(true);expect(retained.every(e=>e.expires_at!==null)).toBe(true);expect(JSON.stringify(retained)).not.toContain(a.email);expect(JSON.stringify(retained)).not.toContain('source.jpg');});
 it("stops identity resurrection while processing",async()=>{const a=await fixture();await assign(a.id);await begin(a.id);await expect(sql.query("INSERT INTO identity_links(canonical_id,identity_type,identity_value) VALUES($1,'email',$2)",[a.canonical,a.email+'new'])).rejects.toThrow(/deletion in progress/);});
 it("takes a fresh verified manual request through the same queue to completion",async()=>{const a=await fixture();await sql.query("UPDATE account_deletion_requests SET status='cancelled' WHERE id=$1",[a.id]);const challenge=(await sql.query("SELECT * FROM create_account_deletion_challenge($1)",[a.user])).rows[0];const created=(await sql.query("SELECT * FROM create_manual_account_deletion_request($1,$2,'2026-10-19.3','web',14,decode('aa','hex'),'v1')",[a.user,challenge.challenge_id])).rows[0];expect(created).toMatchObject({ok:true,status:'manual_review'});await assign(created.request_id);const start=await begin(created.request_id);expect(start.ok).toBe(true);expect(await finalize(created.request_id,start.runToken)).toMatchObject({ok:true,verified:true});expect((await sql.query("SELECT hub_user_id,completion_contact_ciphertext FROM account_deletion_requests WHERE id=$1",[a.id])).rows[0]).toEqual({hub_user_id:null,completion_contact_ciphertext:null});});
 it("requires an active eligible operations team for manual admission",async()=>{await fixture();expect((await sql.query("SELECT admin_deletion_fulfilment_ready() ready")).rows[0].ready).toBe(true);await sql.query("UPDATE admin_users SET is_active=false");expect((await sql.query("SELECT admin_deletion_fulfilment_ready() ready")).rows[0].ready).toBe(false);await sql.query("UPDATE admin_users SET is_active=true");});
 it("requires a current named operator and ownership",async()=>{const a=await fixture();await expect(assign(a.id,randomUUID())).rejects.toThrow();expect(await begin(a.id)).toMatchObject({ok:false,blockers:['assignment_required']});});
 it("refuses older native-only consent",async()=>{const a=await fixture('2026-10-19.2');await assign(a.id);expect(await begin(a.id)).toMatchObject({ok:false,blockers:['policy_reconfirmation_required']});expect((await sql.query("SELECT id FROM auth.users WHERE id=$1",[a.user])).rows).toHaveLength(1);});
 it("serializes concurrent starts and refuses stale or foreign leases",async()=>{const a=await fixture();await assign(a.id);const starts=await Promise.all([begin(a.id),begin(a.id)]);expect(starts.filter(s=>s.ok)).toHaveLength(1);const token=starts.find(s=>s.ok).runToken;await expect(finalize(a.id,token,otherOperator)).rejects.toThrow();await expect(finalize(a.id,randomUUID())).rejects.toThrow();});
 it("requires Storage removal, preserves manifest across failure and retry",async()=>{const a=await fixture();await sql.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('discovery-visit-photos','member-object',$1)",[a.user]);await assign(a.id);const start=await begin(a.id);expect(await finalize(a.id,start.runToken)).toMatchObject({ok:false,blockers:['storage_verification_failed']});await sql.query("SELECT fail_admin_account_deletion($1,$2,$3,'storage_cleanup_failed')",[a.id,operator,start.runToken]);await sql.query("DELETE FROM storage.objects WHERE owner_id=$1",[a.user]);const retry=await begin(a.id);const manifest=(await sql.query("SELECT admin_deletion_storage_page($1,$2,$3,0) m",[a.id,operator,retry.runToken])).rows[0].m;expect(manifest).toContainEqual({bucket:'discovery-visit-photos',key:'member-object'});expect(await finalize(a.id,retry.runToken)).toMatchObject({ok:true});});
 it("blocks unknown user-linked tables and immutable ledger payloads before any cleanup",async()=>{const a=await fixture();await sql.query("CREATE TABLE unexpected_member_history(hub_user_id uuid)");await sql.query("INSERT INTO unexpected_member_history VALUES($1)",[a.user]);await assign(a.id);expect((await begin(a.id)).blockers).toContain('unhandled_member_table:unexpected_member_history');await sql.query("DROP TABLE unexpected_member_history");const b=await fixture();await sql.query("INSERT INTO miles_ledger(canonical_id,amount,direction,source_type,note) VALUES($1,1,'credit','merchant','identifying note')",[b.canonical]);await assign(b.id);expect((await begin(b.id)).blockers).toContain('ledger_payload_review_required');});
 it("rolls back database cleanup if Auth removal fails after preflight",async()=>{const a=await fixture();await assign(a.id);const start=await begin(a.id);await sql.query(`CREATE FUNCTION reject_test_auth_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test auth failure'; END $$; CREATE TRIGGER reject_test_auth_delete BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION reject_test_auth_delete()`);await expect(finalize(a.id,start.runToken)).rejects.toThrow();expect((await sql.query("SELECT user_id FROM hub_user_profiles WHERE user_id=$1",[a.user])).rows).toHaveLength(1);expect((await sql.query("SELECT status FROM account_deletion_requests WHERE id=$1",[a.id])).rows[0].status).toBe('processing');await sql.query("DROP TRIGGER reject_test_auth_delete ON auth.users; DROP FUNCTION reject_test_auth_delete()");});

 it("prevents procedural completion without verified cleanup",async()=>{const a=await fixture();await expect(sql.query("SELECT complete_manual_account_deletion_request($1,'operator')",[a.id])).rejects.toThrow(/verified/);await expect(sql.query("SELECT finish_account_deletion_request($1,'completed')",[a.id])).rejects.toThrow(/verified/);await sql.query("INSERT INTO account_deletion_events(request_id,event_type,actor_kind) VALUES($1,'manual_review_queued','system')",[a.id]);await sql.query("SELECT finish_account_deletion_request($1,'failed')",[a.id]);await expect(sql.query("SELECT finish_account_deletion_request($1,'completed')",[a.id])).rejects.toThrow(/verified/);});
 it("gives completion notices an independent lease and honors expiry",async()=>{const a=await fixture();await assign(a.id);const started=await begin(a.id);await finalize(a.id,started.runToken);expect((await sql.query("SELECT * FROM claim_admin_deletion_completion_email($1)",[a.id])).rows).toHaveLength(1);expect((await sql.query("SELECT * FROM claim_admin_deletion_completion_email($1)",[a.id])).rows).toHaveLength(0);await sql.query("UPDATE account_deletion_requests SET completion_email_lease_expires_at=NULL,completion_contact_expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);expect((await sql.query("SELECT * FROM claim_admin_deletion_completion_email($1)",[a.id])).rows).toHaveLength(0);});
 it("denies public RPC execution and direct case updates",async()=>{for(const role of ['anon','authenticated'])expect((await sql.query("SELECT has_function_privilege($1,'finalize_admin_account_deletion(uuid,uuid,uuid)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);expect((await sql.query("SELECT has_table_privilege('service_role','account_deletion_admin_cases','UPDATE') allowed")).rows[0].allowed).toBe(false);expect((await sql.query("SELECT has_table_privilege('service_role','account_deletion_requests','UPDATE') allowed")).rows[0].allowed).toBe(false);});
});
