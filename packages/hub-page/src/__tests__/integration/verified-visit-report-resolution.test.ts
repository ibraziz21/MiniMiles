import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const cfg = { host: process.env.PG_HOST ?? "127.0.0.1", port: Number(process.env.PG_PORT ?? 5432), user: process.env.PG_USER ?? process.env.USER, password: process.env.PG_PASSWORD ?? "" };
const dbName = `akiba_reports_${process.pid}`;
const admin = new pg.Pool({ ...cfg, database: "postgres" });
const db = new pg.Pool({ ...cfg, database: dbName });
const migration = (name: string) => readFileSync(resolve(__dirname, "../../../../../supabase/migrations", name), "utf8");
let user: string, visit: string, photo: string, report: string;
beforeAll(async () => {
 await admin.query(`DO $$ BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$;`);
 await admin.query(`CREATE DATABASE ${dbName}`);
 await db.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE merchant_discovery_contributions(id uuid PRIMARY KEY,partner_id uuid,suppressed_at timestamptz);
 CREATE TABLE merchant_visit_photos(id uuid PRIMARY KEY,contribution_id uuid REFERENCES merchant_discovery_contributions, partner_id uuid,suppressed_at timestamptz);
 CREATE TABLE discovery_moderation_audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),photo_id uuid REFERENCES merchant_visit_photos,actor_id text,action text,reason_code text,before_status text,after_status text,request_correlation_id text,created_at timestamptz DEFAULT now());
 CREATE TABLE refresh_calls(partner_id uuid,reason text);
 CREATE FUNCTION enqueue_merchant_discovery_projection_refresh(uuid,text) RETURNS void LANGUAGE sql AS 'INSERT INTO refresh_calls VALUES ($1,$2)';`);
 await db.query(migration("104_verified_visit_reports.sql"));
 const suppression = migration("092_verified_discovery_suppression_and_indexes.sql").match(/CREATE OR REPLACE FUNCTION set_visit_photo_suppression[\s\S]*?\n\$\$;/)![0];
 await db.query(suppression);
 await db.query(migration("107_resolve_verified_visit_reports.sql"));
});
afterAll(async () => { await db.end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end(); });
beforeEach(async () => {
 await db.query("TRUNCATE merchant_verified_visit_reports,discovery_moderation_audit_events,merchant_visit_photos,merchant_discovery_contributions,auth.users,refresh_calls CASCADE");
 user=randomUUID();visit=randomUUID();photo=randomUUID();report=randomUUID();
 await db.query("INSERT INTO auth.users VALUES ($1)",[user]);
 await db.query("INSERT INTO merchant_discovery_contributions VALUES ($1,$2,NULL)",[visit,randomUUID()]);
 await db.query("INSERT INTO merchant_visit_photos SELECT $1,id,partner_id,NULL FROM merchant_discovery_contributions WHERE id=$2",[photo,visit]);
 await db.query("INSERT INTO merchant_verified_visit_reports(id,contribution_id,photo_id,reporter_hub_user_id,reason_code) VALUES ($1,$2,$3,$4,'spam')",[report,visit,photo,user]);
});
async function run(action: string, reason: string) { return (await db.query("SELECT resolve_verified_visit_report($1,$2,$3,'moderator','correlation') AS result",[report,action,reason])).rows[0].result; }
describe("transactional report resolution", () => {
 it("hides the visit and photos and records the moderator in one transaction", async () => { expect(await run("hide_visit","policy_violation")).toEqual({ok:true}); const r=(await db.query("SELECT * FROM merchant_verified_visit_reports")).rows[0]; expect(r.status).toBe("actioned");expect(r.resolved_by).toBe("moderator"); expect(r.resolution_note).toBe("hide_visit:policy_violation:correlation"); expect((await db.query("SELECT suppressed_at FROM merchant_visit_photos")).rows[0].suppressed_at).not.toBeNull(); expect((await db.query("SELECT suppressed_at FROM merchant_discovery_contributions")).rows[0].suppressed_at).not.toBeNull(); expect((await db.query("SELECT count(*)::int AS n FROM discovery_moderation_audit_events")).rows[0].n).toBe(1); });
 it("photo-only action leaves the visit visible", async () => { expect(await run("hide_photo","other")).toEqual({ok:true}); expect((await db.query("SELECT suppressed_at FROM merchant_discovery_contributions")).rows[0].suppressed_at).toBeNull(); });
 it("dismissal leaves content unchanged and cannot be overwritten", async () => { expect(await run("dismiss","no_violation")).toEqual({ok:true}); expect(await run("hide_visit","other")).toEqual({ok:false,error_code:"already_resolved"}); expect((await db.query("SELECT suppressed_at FROM merchant_visit_photos")).rows[0].suppressed_at).toBeNull(); });
 it("rejects a photo from another visit without resolving the report", async () => { const other=randomUUID(); await db.query("INSERT INTO merchant_discovery_contributions VALUES ($1,$2,NULL)",[other,randomUUID()]); await db.query("UPDATE merchant_visit_photos SET contribution_id=$1",[other]); expect(await run("hide_photo","other")).toEqual({ok:false,error_code:"invalid_photo"}); });
 it("rolls back content changes when a later photo suppression fails", async () => { const second=randomUUID(); await db.query("INSERT INTO merchant_visit_photos SELECT $1,id,partner_id,NULL FROM merchant_discovery_contributions",[second]); await db.query("INSERT INTO discovery_moderation_audit_events(photo_id,actor_id,action,before_status,after_status) SELECT $1,'moderator','suppress','a','b' FROM generate_series(1,29)",[photo]); await expect(run("hide_visit","other")).rejects.toThrow("suppression failed"); expect((await db.query("SELECT count(*)::int AS n FROM merchant_visit_photos WHERE suppressed_at IS NOT NULL")).rows[0].n).toBe(0); expect((await db.query("SELECT status FROM merchant_verified_visit_reports")).rows[0].status).toBe("pending"); });
 it("does not expose the RPC to authenticated or anonymous roles", async () => { for (const role of ["anon","authenticated"]) { expect((await db.query("SELECT has_function_privilege($1,'resolve_verified_visit_report(uuid,text,text,text,text)','EXECUTE') AS allowed",[role])).rows[0].allowed).toBe(false); } });
});
