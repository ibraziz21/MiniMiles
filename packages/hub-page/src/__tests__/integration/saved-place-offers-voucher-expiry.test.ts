/**
 * Integration tests for migration 125 (saved-place offer and voucher expiry
 * pushes).
 *
 * Both producers live in SQL, so their rules — who is told, how often, when
 * not to send, what is never repeated — can only be shown against a real
 * database. The tables below carry the columns 125 reads, with their real
 * foreign keys to auth.users / partners / issued_vouchers so the cascades
 * are exercised too.
 *
 * Requires a local PostgreSQL:
 *   pg_isready → should report "accepting connections"
 *   pnpm --filter @akibamiles/hub-page test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

const DB_NAME = "hub_saved_offers_voucher_expiry_test";

const DB_CONFIG = {
  host: process.env.PG_HOST ?? "localhost",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? process.env.USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "",
  database: DB_NAME,
};

const MIGRATION_125 = readFileSync(
  resolve(__dirname, "../../../../../supabase/migrations/125_saved_place_offers_and_voucher_expiry_push.sql"),
  "utf8",
);

const SETUP_SQL = `
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
GRANT ALL ON SCHEMA public TO public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE spend_voucher_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES partners(id),
  title text NOT NULL
);
CREATE TABLE issued_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid REFERENCES auth.users(id),
  voucher_template_id uuid REFERENCES spend_voucher_templates(id),
  status text NOT NULL DEFAULT 'issued',
  expires_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hub_user_saved_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_user_id, merchant_id)
);
CREATE TABLE notification_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref    text NOT NULL,
  hub_user_id uuid REFERENCES auth.users(id),
  template    text NOT NULL,
  category    text,
  deep_link   text,
  dedupe_key  text UNIQUE,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notification_outbox(id),
  hub_user_id     uuid NOT NULL,
  available_at    timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION enqueue_web_push_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_notification_outbox_enqueue_push
  AFTER INSERT ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION enqueue_web_push_job();
`;

// 12:00 and 23:00 Nairobi (UTC+3).
const NOON = "2026-11-10T09:00:00Z";
const NIGHT = "2026-11-10T20:00:00Z";

let pool: pg.Pool;

async function withAdmin<T>(run: (admin: pg.Pool) => Promise<T>): Promise<T> {
  const admin = new Pool({ ...DB_CONFIG, database: "postgres" });
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

const newUser = () => one<{ id: string }>("INSERT INTO auth.users DEFAULT VALUES RETURNING id").then((r) => r.id);
const newPartner = (name: string) =>
  one<{ id: string }>("INSERT INTO partners (name) VALUES ($1) RETURNING id", [name]).then((r) => r.id);

async function save(userId: string, merchantId: string, savedAt = "2026-11-01T09:00:00Z") {
  await pool.query(
    "INSERT INTO hub_user_saved_merchants (hub_user_id, merchant_id, created_at) VALUES ($1, $2, $3)",
    [userId, merchantId, savedAt],
  );
}

function offer(key: string, merchants: Array<{ id: string; name?: string; slug?: string }>, title = "20% off brunch") {
  return { key, title, merchants: merchants.map((m) => ({ name: "Kahawa Corner", slug: "kahawa-corner", ...m })) };
}

async function sight(source: string, offers: unknown[], now = NOON) {
  return one<{ result: Record<string, unknown> }>(
    "SELECT record_offer_sightings($1, $2::jsonb, $3) AS result",
    [source, JSON.stringify(offers), now],
  ).then((r) => r.result);
}

async function outbox(template: string) {
  const { rows } = await pool.query(
    "SELECT hub_user_id, deep_link, category, dedupe_key, metadata FROM notification_outbox WHERE template = $1 ORDER BY created_at, dedupe_key",
    [template],
  );
  return rows as Array<{ hub_user_id: string; deep_link: string; category: string; dedupe_key: string; metadata: Record<string, unknown> }>;
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  });
  pool = new Pool(DB_CONFIG);
  await pool.query(SETUP_SQL);
  await pool.query(MIGRATION_125);
});

afterAll(async () => {
  await pool?.end();
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
});

beforeEach(async () => {
  await pool.query(`TRUNCATE web_push_jobs, notification_outbox, hub_offer_sightings, hub_offer_sighting_sources,
    hub_voucher_expiry_reminders, issued_vouchers, spend_voucher_templates, hub_user_saved_merchants, partners, auth.users CASCADE`);
});

describe("migration 125 — schema", () => {
  it("applies twice without error", async () => {
    await pool.query(MIGRATION_125);
  });

  it("whitelists both templates for push, sent immediately", async () => {
    const user = await newUser();
    for (const template of ["saved_place_offer", "voucher_expiring"]) {
      await pool.query(
        "INSERT INTO notification_outbox (user_ref, hub_user_id, template, category) VALUES ($1::text, $1::uuid, $2, 'vouchers')",
        [user, template],
      );
    }
    const { rows } = await pool.query(
      `SELECT n.template, EXTRACT(EPOCH FROM (j.available_at - now())) AS delay
         FROM web_push_jobs j JOIN notification_outbox n ON n.id = j.notification_id`,
    );
    expect(rows.map((r) => r.template).sort()).toEqual(["saved_place_offer", "voucher_expiring"]);
    for (const row of rows) expect(Number(row.delay)).toBeLessThan(5);
  });

  it("keeps the 45-minute hold on the recommendation ask", async () => {
    const user = await newUser();
    await pool.query(
      "INSERT INTO notification_outbox (user_ref, hub_user_id, template, category) VALUES ($1::text, $1::uuid, 'contribution_requested', 'earnings')",
      [user],
    );
    const { delay } = await one<{ delay: string }>(
      "SELECT EXTRACT(EPOCH FROM (available_at - now())) AS delay FROM web_push_jobs",
    );
    expect(Number(delay)).toBeGreaterThan(44 * 60);
  });

  it("is reachable by service_role only", async () => {
    const { rows } = await pool.query(
      `SELECT p.proname,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed
         FROM pg_proc p
        WHERE p.proname IN ('record_offer_sightings', 'queue_voucher_expiry_reminders')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect([row.service, row.anon, row.authed]).toEqual([true, false, false]);
  });
});

describe("migration 125 — saved-place offers", () => {
  it("records a source's first scan without announcing what was already live", async () => {
    const user = await newUser();
    const merchant = await newPartner("Kahawa Corner");
    await save(user, merchant);

    const first = await sight("funded", [offer("funded:a1", [{ id: merchant }])]);
    expect(first).toMatchObject({ baselined: true, queued: 0 });
    expect(await outbox("saved_place_offer")).toHaveLength(0);

    // Seen again later: still nothing, it isn't new.
    await sight("funded", [offer("funded:a1", [{ id: merchant }])]);
    expect(await outbox("saved_place_offer")).toHaveLength(0);
  });

  it("tells members who saved the place, with a link to it, once", async () => {
    const saver = await newUser();
    const stranger = await newUser();
    const merchant = await newPartner("Kahawa Corner");
    await save(saver, merchant);
    await sight("merchant_offer", []);

    const result = await sight("merchant_offer", [offer("merchant_offer:o1", [{ id: merchant }])]);
    expect(result).toMatchObject({ baselined: false, new_offers: 1, queued: 1 });

    const rows = await outbox("saved_place_offer");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hub_user_id: saver,
      category: "vouchers",
      deep_link: "/merchants/kahawa-corner",
      metadata: { offerTitle: "20% off brunch", merchantName: "Kahawa Corner", merchantId: merchant },
    });
    expect(rows.some((r) => r.hub_user_id === stranger)).toBe(false);

    await sight("merchant_offer", [offer("merchant_offer:o1", [{ id: merchant }])]);
    expect(await outbox("saved_place_offer")).toHaveLength(1);
  });

  it("reaches savers of any participating merchant in a multi-merchant offer", async () => {
    const a = await newUser();
    const b = await newUser();
    const first = await newPartner("First");
    const second = await newPartner("Second");
    await save(a, first);
    await save(b, second);
    await sight("funded", []);

    await sight("funded", [offer("funded:multi", [{ id: first, slug: "first" }, { id: second, slug: "second" }])]);

    const rows = await outbox("saved_place_offer");
    expect(Object.fromEntries(rows.map((r) => [r.hub_user_id, r.deep_link]))).toEqual({
      [a]: "/merchants/first",
      [b]: "/merchants/second",
    });
  });

  it("doesn't announce an offer to someone who saved the place after it appeared", async () => {
    const user = await newUser();
    const merchant = await newPartner("Kahawa Corner");
    await save(user, merchant, "2026-11-10T09:30:00Z");
    await sight("template", []);

    await sight("template", [offer("template:t1", [{ id: merchant }])], NOON);
    expect(await outbox("saved_place_offer")).toHaveLength(0);
  });

  it("sends at most one a day per member, across sources", async () => {
    const user = await newUser();
    const merchant = await newPartner("Kahawa Corner");
    await save(user, merchant);
    await sight("funded", []);
    await sight("template", []);

    await sight("funded", [offer("funded:a", [{ id: merchant }]), offer("funded:b", [{ id: merchant }])]);
    await sight("template", [offer("template:c", [{ id: merchant }])]);
    expect(await outbox("saved_place_offer")).toHaveLength(1);

    await sight("template", [offer("template:d", [{ id: merchant }])], "2026-11-11T10:00:00Z");
    expect(await outbox("saved_place_offer")).toHaveLength(2);
  });

  it("waits until morning instead of sending at night", async () => {
    const user = await newUser();
    const merchant = await newPartner("Kahawa Corner");
    await save(user, merchant);
    await sight("funded", []);

    const night = await sight("funded", [offer("funded:late", [{ id: merchant }])], NIGHT);
    expect(night).toMatchObject({ quiet_hours: true, queued: 0 });
    expect(await outbox("saved_place_offer")).toHaveLength(0);

    await sight("funded", [offer("funded:late", [{ id: merchant }])], "2026-11-11T06:00:00Z");
    expect(await outbox("saved_place_offer")).toHaveLength(1);
  });

  it("drops malformed entries without failing the batch", async () => {
    const user = await newUser();
    const merchant = await newPartner("Kahawa Corner");
    await save(user, merchant);
    await sight("funded", []);

    const result = await sight("funded", [
      offer("funded:ok", [{ id: "not-a-uuid" }, { id: merchant, slug: "../../evil" }]),
      offer("template:wrong-source", [{ id: merchant }]),
      { key: "funded:untitled", title: "  ", merchants: [{ id: merchant }] },
      "nonsense",
    ]);

    expect(result).toMatchObject({ new_offers: 1, queued: 1 });
    expect((await outbox("saved_place_offer"))[0].deep_link).toBe("/merchants");
    await expect(sight("unknown", [])).rejects.toThrow(/unknown offer source/);
  });
});

describe("migration 125 — voucher expiry reminders", () => {
  async function voucher(
    userId: string | null,
    opts: { title?: string; partner?: string; expiresAt: string; createdAt?: string; status?: string },
  ) {
    const partnerId = await newPartner(opts.partner ?? "Kahawa Corner");
    const { id: templateId } = await one<{ id: string }>(
      "INSERT INTO spend_voucher_templates (partner_id, title) VALUES ($1, $2) RETURNING id",
      [partnerId, opts.title ?? "25% off"],
    );
    return one<{ id: string }>(
      `INSERT INTO issued_vouchers (hub_user_id, voucher_template_id, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, templateId, opts.status ?? "issued", opts.expiresAt, opts.createdAt ?? "2026-11-04T09:00:00Z"],
    ).then((r) => r.id);
  }

  const queue = (now = NOON) =>
    one<{ n: number }>("SELECT queue_voucher_expiry_reminders($1) AS n", [now]).then((r) => Number(r.n));

  it("reminds once, about a day ahead, with a link to the voucher", async () => {
    const user = await newUser();
    const id = await voucher(user, { expiresAt: "2026-11-11T07:00:00Z" });

    expect(await queue()).toBe(1);
    const rows = await outbox("voucher_expiring");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hub_user_id: user,
      category: "vouchers",
      deep_link: `/my-vouchers?voucher=${id}`,
      metadata: { count: 1, title: "25% off", merchantName: "Kahawa Corner", voucherIds: [id] },
    });

    expect(await queue("2026-11-10T10:00:00Z")).toBe(0);
    expect(await outbox("voucher_expiring")).toHaveLength(1);
  });

  it("groups a member's vouchers expiring together into one push", async () => {
    const user = await newUser();
    const early = await voucher(user, { expiresAt: "2026-11-10T18:00:00Z" });
    const late = await voucher(user, { expiresAt: "2026-11-11T08:00:00Z" });

    expect(await queue()).toBe(1);
    const [row] = await outbox("voucher_expiring");
    expect(row.deep_link).toBe("/my-vouchers");
    expect(row.metadata).toMatchObject({ count: 2, voucherIds: [early, late] });
    expect(Date.parse(row.metadata.expiresAt as string)).toBe(Date.parse("2026-11-10T18:00:00Z"));
  });

  it("skips used, unowned, short-lived, far-off and nearly-gone vouchers", async () => {
    const user = await newUser();
    await voucher(user, { expiresAt: "2026-11-11T07:00:00Z", status: "redeemed" });
    await voucher(null, { expiresAt: "2026-11-11T07:00:00Z" });
    await voucher(user, { expiresAt: "2026-11-11T07:00:00Z", createdAt: "2026-11-09T09:00:00Z" });
    await voucher(user, { expiresAt: "2026-11-12T09:00:00Z" });
    await voucher(user, { expiresAt: "2026-11-10T10:30:00Z" });

    expect(await queue()).toBe(0);
    expect(await outbox("voucher_expiring")).toHaveLength(0);
  });

  it("sends nothing at night, and still catches the voucher the next morning", async () => {
    const user = await newUser();
    await voucher(user, { expiresAt: "2026-11-11T10:00:00Z" });

    expect(await queue(NIGHT)).toBe(0);
    expect(await queue("2026-11-11T06:00:00Z")).toBe(1);
  });

  it("forgets the reminder when the voucher is deleted", async () => {
    const user = await newUser();
    const id = await voucher(user, { expiresAt: "2026-11-11T07:00:00Z" });
    await queue();

    await pool.query("DELETE FROM issued_vouchers WHERE id = $1", [id]);
    const { count } = await one<{ count: string }>("SELECT count(*) FROM hub_voucher_expiry_reminders");
    expect(Number(count)).toBe(0);
  });
});
