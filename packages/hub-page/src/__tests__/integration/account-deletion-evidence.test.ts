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
const db = `akiba_evidence_${process.pid}`;
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
});

afterAll(async () => {
  await sql.end();
  await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await admin.end();
});

async function request(status = "processing") {
  const user = randomUUID(), id = randomUUID();
  await sql.query("INSERT INTO auth.users VALUES($1,$2)", [user,`member.${user}@example.com`]);
  await sql.query(`INSERT INTO account_deletion_requests(id,hub_user_id,status,source,policy_version,target_completion_at)
    VALUES($1,$2,$3,'native_android','test',now()+interval '14 days')`, [id,user,status]);
  return { user, id };
}
async function evidence(id: string, category = "rewards", payload = { kind: "earning", amount: 5 }) {
  await sql.query("INSERT INTO account_deletion_evidence(request_id,category,payload) VALUES($1,$2,$3)", [id,category,payload]);
}
async function complete(id: string) {
  await sql.query("SELECT * FROM finish_account_deletion_request($1,'completed')",[id]);
}

describe("native deletion evidence migration", () => {
  it("denies ordinary roles and the general service client direct evidence reads/writes", async () => {
    for (const role of ["anon","authenticated","service_role"]) {
      const { rows } = await sql.query("SELECT has_table_privilege($1,'account_deletion_evidence','SELECT') AS read, has_table_privilege($1,'account_deletion_evidence','INSERT') AS write", [role]);
      expect(rows[0]).toEqual({ read:false,write:false });
    }
    const { rows } = await sql.query("SELECT has_function_privilege('anon','execute_account_deletion_step(uuid,text)','EXECUTE') AS run");
    expect(rows[0].run).toBe(false);
  });

  it("rejects arbitrary JSON and personal data in evidence", async () => {
    const { id } = await request();
    await expect(evidence(id,"rewards",{ email:"member@example.com" } as never)).rejects.toThrow();
    await expect(evidence(id,"rewards",{ kind:"member@example.com" } as never)).rejects.toThrow();
    await evidence(id);
  });

  it("starts clocks on completion, detaches identity and does not extend them on retry", async () => {
    const { id } = await request();
    await evidence(id); await evidence(id,"moderation",{ action:"approve" } as never);
    await complete(id);
    const { rows } = await sql.query(`SELECT r.hub_user_id, r.evidence_expires_at = r.completed_at+interval '24 months' AS proof,
      bool_and(e.expires_at=r.completed_at+CASE WHEN e.category='moderation' THEN interval '90 days' ELSE interval '180 days' END) AS clocks
      FROM account_deletion_requests r JOIN account_deletion_evidence e ON e.request_id=r.id WHERE r.id=$1 GROUP BY r.id`,[id]);
    expect(rows[0]).toEqual({hub_user_id:null,proof:true,clocks:true});
    const before = await sql.query("SELECT expires_at FROM account_deletion_evidence WHERE request_id=$1 ORDER BY id",[id]);
    await sql.query("SELECT * FROM finish_account_deletion_request($1,'completed')",[id]);
    expect((await sql.query("SELECT expires_at FROM account_deletion_evidence WHERE request_id=$1 ORDER BY id",[id])).rows).toEqual(before.rows);
  });

  it("only expires completed, due and unheld evidence", async () => {
    const a = await request(), b = await request();
    await evidence(a.id); await evidence(b.id);
    await complete(a.id);
    await sql.query("UPDATE account_deletion_evidence SET expires_at=now()-interval '1 day' WHERE request_id=ANY($1)",[[a.id,b.id]]);
    await sql.query("UPDATE account_deletion_evidence SET hold_reason_code='dispute',hold_owner='privacy',hold_review_at=now()+interval '7 days' WHERE request_id=$1",[a.id]);
    await sql.query("SELECT expire_account_deletion_evidence()");
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_evidence WHERE request_id=ANY($1)",[[a.id,b.id]])).rows[0].n).toBe(2);
    await sql.query("UPDATE account_deletion_evidence SET hold_reason_code=NULL,hold_owner=NULL,hold_review_at=NULL WHERE request_id=$1",[a.id]);
    await sql.query("SELECT expire_account_deletion_evidence()");
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_evidence WHERE request_id=$1",[a.id])).rows[0].n).toBe(0);
  });

  it("blocks unresolved in-flight spend before cleanup", async () => {
    const { id,user } = await request("cancelled");
    const template=randomUUID(),merchant=randomUUID(),voucher=randomUUID();
    await sql.query("INSERT INTO spend_voucher_templates VALUES($1)",[template]);
    await sql.query("INSERT INTO partners VALUES($1)",[merchant]);
    await sql.query("INSERT INTO issued_vouchers(id,hub_user_id) VALUES($1,$2)",[voucher,user]);
    await sql.query(`INSERT INTO miles_spend_intents(idempotency_key,request_hash,hub_user_id,voucher_id,template_id,merchant_id,total_points,ledger_points,consent_method,disclosure_version)
      VALUES($1,'hash',$2,$3,$4,$5,10,10,'hub_ui_confirmed','test')`,[randomUUID(),user,voucher,template,merchant]);
    await sql.query("UPDATE account_deletion_requests SET status='processing' WHERE id=$1",[id]);
    await expect(sql.query("SELECT execute_account_deletion_step($1,'preflight')",[id])).rejects.toThrow(/reconciliation/);
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_evidence WHERE request_id=$1",[id])).rows[0].n).toBe(0);
  });

  it("keeps ordinary moderation audit mutation forbidden", async () => {
    // Even the definer owner cannot erase evidence without the processing context.
    const { rows }=await sql.query("SELECT pg_get_functiondef('reject_discovery_moderation_audit_mutation()'::regprocedure) AS definition");
    expect(rows[0].definition).toContain("r.status = 'processing'");
    await expect(sql.query("SELECT execute_account_deletion_step($1,'published_photos')",[randomUUID()])).rejects.toThrow(/not processing/);
  });

  it("archives only minimal moderation evidence and removes the full content chain for its member", async () => {
    const a=await request("cancelled"),b=await request("cancelled");
    const partner=randomUUID(),template=randomUUID();
    await sql.query("INSERT INTO partners VALUES($1)",[partner]);
    await sql.query("INSERT INTO discovery_question_templates VALUES($1)",[template]);
    async function photo(user: string) {
      const earning=randomUUID(),draft=randomUUID(),contribution=randomUUID(),photo=randomUUID();
      await sql.query(`INSERT INTO verified_earning_events(id,event_id,hub_user_id,partner_id,source,occurred_at)
        VALUES($1,$2,$3,$4,'merchant_scan',now())`,[earning,randomUUID(),user,partner]);
      await sql.query(`INSERT INTO discovery_contribution_requests(id,earning_event_id,hub_user_id,partner_id,template_id,template_version,template_snapshot,expires_at)
        VALUES($1,$2,$3,$4,$5,1,'{}',now()+interval '1 day')`,[draft,earning,user,partner,template]);
      await sql.query(`INSERT INTO merchant_discovery_contributions(id,request_id,hub_user_id,partner_id,would_recommend)
        VALUES($1,$2,$3,$4,true)`,[contribution,draft,user,partner]);
      await sql.query(`INSERT INTO merchant_visit_photos(id,contribution_id,hub_user_id,partner_id,private_source_key,consent_version)
        VALUES($1,$2,$3,$4,'private-secret.jpg','test')`,[photo,contribution,user,partner]);
      await sql.query(`INSERT INTO discovery_moderation_audit_events(photo_id,actor_id,action,reason_code,before_status,after_status)
        VALUES($1,'staff-identity','approve','quality_ok','pending','approved')`,[photo]);
      return photo;
    }
    const p1=await photo(a.user),p2=await photo(b.user);
    await expect(sql.query("DELETE FROM discovery_moderation_audit_events WHERE photo_id=$1",[p2])).rejects.toThrow(/append-only/);
    await sql.query("UPDATE account_deletion_requests SET status='processing' WHERE id=$1",[a.id]);
    for(const step of ["published_photos","unpublished_contributions","earning_events"]) {
      await sql.query("SELECT execute_account_deletion_step($1,$2)",[a.id,step]);
      await sql.query("SELECT execute_account_deletion_step($1,$2)",[a.id,step]); // replay
    }
    expect((await sql.query("SELECT id FROM merchant_visit_photos WHERE id=ANY($1)",[[p1,p2]])).rows).toEqual([{id:p2}]);
    const retained=(await sql.query("SELECT payload FROM account_deletion_evidence WHERE request_id=$1 AND category='moderation'",[a.id])).rows;
    expect(retained).toHaveLength(1);
    expect(Object.keys(retained[0].payload).sort()).toEqual(["action","reason_code","before_status","after_status","occurred_at"].sort());
    expect(JSON.stringify(retained)).not.toMatch(/private-secret|staff-identity/);
    expect((await sql.query("SELECT count(*)::int n FROM verified_earning_events WHERE hub_user_id=$1",[a.user])).rows[0].n).toBe(0);
  });

  it("does not allow new voucher writes while deletion is pending", async () => {
    const {user}=await request();
    await expect(sql.query("INSERT INTO issued_vouchers(hub_user_id) VALUES($1)",[user])).rejects.toThrow(/deletion in progress/);
  });

  it("native evidence completion preserves the shared Auth identity", async () => {
    const {id,user}=await request();
    await complete(id);
    expect((await sql.query("SELECT id FROM auth.users WHERE id=$1",[user])).rows).toEqual([{id:user}]);
  });

  it("preserves shared canonical and ledger rows under the native-only scope", async () => {
    const {id,user}=await request("cancelled"),canonical=randomUUID(),otherCanonical=randomUUID();
    await sql.query("INSERT INTO hub_user_canonicals VALUES($1,$2)",[user,canonical]);
    await sql.query("INSERT INTO identity_links(canonical_id,identity_type,identity_value) SELECT $1,'email',email FROM auth.users WHERE id=$2",[canonical,user]);
    await sql.query(`INSERT INTO miles_ledger(canonical_id,amount,direction,source_type,note) VALUES
      ($1,25,'credit','merchant','private note'),($2,50,'credit','merchant','other member')`,[canonical,otherCanonical]);
    await expect(sql.query("DELETE FROM miles_ledger WHERE canonical_id=$1",[canonical])).rejects.toThrow(/immutable/);
    await sql.query("UPDATE account_deletion_requests SET status='processing' WHERE id=$1",[id]);
    await expect(sql.query("SELECT execute_account_deletion_step($1,'canonical_identity')",[id])).rejects.toThrow(/outside native release scope/);
    expect((await sql.query("SELECT count(*)::int n FROM miles_ledger WHERE canonical_id=ANY($1)",[[canonical,otherCanonical]])).rows[0].n).toBe(2);
    expect((await sql.query("SELECT count(*)::int n FROM identity_links WHERE canonical_id=$1",[canonical])).rows[0].n).toBe(1);
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_evidence WHERE request_id=$1",[id])).rows[0].n).toBe(0);
  });

  it("refuses new requests with unsupported history before consuming their challenge", async () => {
    const {user}=await request("cancelled"),canonical=randomUUID();
    await sql.query("INSERT INTO hub_user_canonicals VALUES($1,$2)",[user,canonical]);
    await sql.query("CREATE TABLE unsupported_history(id uuid,canonical_id uuid)");
    await sql.query("INSERT INTO unsupported_history VALUES($1,$2)",[randomUUID(),canonical]);
    const challenge=(await sql.query("SELECT * FROM create_account_deletion_challenge($1)",[user])).rows[0];
    const result=(await sql.query("SELECT * FROM create_account_deletion_request($1,$2,'test','native_android')",[user,challenge.challenge_id])).rows[0];
    expect(result).toMatchObject({ok:false,error_code:"deletion_unavailable"});
    expect((await sql.query("SELECT consumed_at FROM account_deletion_challenges WHERE id=$1",[challenge.challenge_id])).rows[0].consumed_at).toBeNull();
    await sql.query("DROP TABLE unsupported_history");
  });

  it("purges completion contacts at their deadline and expires proof with child events", async () => {
    const {id}=await request();
    await sql.query("UPDATE account_deletion_requests SET completion_contact_ciphertext='\\x01',completion_contact_key_version='v1' WHERE id=$1",[id]);
    await complete(id);
    await sql.query("UPDATE account_deletion_requests SET completion_contact_expires_at=now()-interval '1 minute' WHERE id=$1",[id]);
    await sql.query("SELECT * FROM claim_account_deletion_completion_emails()");
    expect((await sql.query("SELECT completion_contact_ciphertext FROM account_deletion_requests WHERE id=$1",[id])).rows[0].completion_contact_ciphertext).toBeNull();
    await sql.query("UPDATE account_deletion_requests SET evidence_expires_at=now()-interval '1 minute' WHERE id=$1",[id]);
    await sql.query("SELECT expire_account_deletion_evidence()");
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_requests WHERE id=$1",[id])).rows[0].n).toBe(0);
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_events WHERE request_id=$1",[id])).rows[0].n).toBe(0);
  });

  it("detaches a referral without removing the other member's completed entitlement, then expires its evidence", async () => {
    const a=await request("cancelled"),b=await request("cancelled");
    const program=randomUUID(),code=randomUUID(),click=randomUUID(),pass=randomUUID(),ref=randomUUID();
    await sql.query("INSERT INTO referral_program_versions VALUES($1)",[program]);
    await sql.query("INSERT INTO hub_user_passes VALUES($1,$2)",[pass,b.user]);
    await sql.query("INSERT INTO hub_referral_codes(id,hub_user_id,code) VALUES($1,$2,$3)",[code,a.user,randomUUID()]);
    await sql.query(`INSERT INTO referral_clicks(id,referral_code_id,program_version_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '1 day')`,[click,code,program,randomUUID()]);
    await sql.query(`INSERT INTO hub_referrals(id,program_version_id,referral_code_id,referral_click_id,referrer_user_id,referred_user_id,referred_pass_id,
      signup_reward_miles,activation_reward_miles,min_purchase_kes,activation_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,10,20,100,now()+interval '1 day')`,[ref,program,code,click,a.user,b.user,pass]);
    await sql.query(`INSERT INTO referral_reward_jobs(referral_id,milestone,recipient_user_id,amount_miles,idempotency_key,status,eligible_at,released_at)
      VALUES($1,'signup',$2,10,$3,'released',now(),now())`,[ref,b.user,randomUUID()]);
    await sql.query("UPDATE account_deletion_requests SET status='processing' WHERE id=$1",[a.id]);
    await sql.query("SELECT execute_account_deletion_step($1,'referrals')",[a.id]);
    await sql.query("SELECT execute_account_deletion_step($1,'referrals')",[a.id]);
    expect((await sql.query("SELECT referrer_user_id,referred_user_id,referral_code_id,referral_click_id FROM hub_referrals WHERE id=$1",[ref])).rows[0])
      .toEqual({referrer_user_id:null,referred_user_id:b.user,referral_code_id:null,referral_click_id:null});
    expect((await sql.query("SELECT recipient_user_id,status FROM referral_reward_jobs WHERE referral_id=$1",[ref])).rows[0])
      .toEqual({recipient_user_id:b.user,status:"released"});
    expect((await sql.query("SELECT count(*)::int n FROM account_deletion_evidence WHERE request_id=$1",[a.id])).rows[0].n).toBe(1);
    await complete(a.id);
    await sql.query("UPDATE hub_referrals SET evidence_expires_at=now()-interval '1 minute' WHERE id=$1",[ref]);
    await sql.query("SELECT expire_account_deletion_evidence()");
    expect((await sql.query("SELECT count(*)::int n FROM hub_referrals WHERE id=$1",[ref])).rows[0].n).toBe(0);
    expect((await sql.query("SELECT count(*)::int n FROM auth.users WHERE id=$1",[b.user])).rows[0].n).toBe(1);
  });
});
