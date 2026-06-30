/**
 * Tests for Akiba Pass endpoints — DB-backed stable pass IDs.
 *
 * Covers:
 *  - GET /api/me/pass       returns publicPassId + qrPayload, no sensitive fields
 *  - GET /api/me/pass/resolve  auth check, safe field set, 404 on unknown passId
 *  - POST /api/me/pass/regenerate  issues a new UUID
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Env ───────────────────────────────────────────────────────────────────────
process.env.AKIBA_API_KEY = "test-platform-key";

// ── Known fixtures ────────────────────────────────────────────────────────────
const KNOWN_PASS_ID  = "11111111-2222-3333-4444-555555555555";
const NEW_PASS_ID    = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const KNOWN_PASS_ROW = { public_pass_id: KNOWN_PASS_ID, user_id: "user-uuid", email: "alice@example.com" };
const KNOWN_USER_ROW = { full_name: "Alice K.", username: "alicek" };

// ── Mutable flag: controls whether hub_user_passes returns a row ──────────────
// Must be prefixed "mock" so Vitest's vi.mock hoisting allows reference.
let mockPassExists = true;

// ── Mock auth ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-uuid", email: "alice@example.com" } },
      }),
    },
  }),
}));

// ── Mock admin client ─────────────────────────────────────────────────────────
// Routes table queries to the appropriate fixture based on table name.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      // Fluent builder — each method returns the same object for chaining.
      // Leaf operations (maybeSingle / single) use `table` to route the result.
      const builder = {
        select: () => builder,
        eq:     () => builder,
        insert: () => builder,
        update: () => builder,

        async maybeSingle() {
          if (table === "hub_user_passes") {
            return {
              data: mockPassExists ? KNOWN_PASS_ROW : null,
              error: null,
            };
          }
          if (table === "users") {
            return { data: KNOWN_USER_ROW, error: null };
          }
          return { data: null, error: null };
        },

        async single() {
          if (table === "hub_user_passes") {
            // Used by both insert (first-time creation) and update (regenerate)
            return { data: { ...KNOWN_PASS_ROW, public_pass_id: NEW_PASS_ID }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  }),
}));

// ── Import routes AFTER mocks ─────────────────────────────────────────────────
const { GET: passGET }       = await import("@/app/api/me/pass/route");
const { GET: resolveGET }    = await import("@/app/api/me/pass/resolve/route");
const { POST: regeneratePOST } = await import("@/app/api/me/pass/regenerate/route");

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveRequest(passId: string, authKey = "test-platform-key"): Request {
  return new Request(
    `http://localhost/api/me/pass/resolve?passId=${encodeURIComponent(passId)}`,
    { headers: { Authorization: `Bearer ${authKey}` } },
  );
}

// ── GET /api/me/pass ──────────────────────────────────────────────────────────
describe("GET /api/me/pass", () => {
  beforeEach(() => { mockPassExists = true; vi.clearAllMocks(); });

  it("returns 200 with publicPassId and qrPayload", async () => {
    const res  = await passGET();
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(typeof json.publicPassId).toBe("string");
    expect(typeof json.qrPayload).toBe("string");
  });

  it("qrPayload starts with akiba-pass:v1:", async () => {
    const res  = await passGET();
    const { qrPayload } = await res.json() as { qrPayload: string };
    expect(qrPayload).toMatch(/^akiba-pass:v1:/);
  });

  it("qrPayload contains the publicPassId", async () => {
    const res  = await passGET();
    const { publicPassId, qrPayload } = await res.json() as { publicPassId: string; qrPayload: string };
    expect(qrPayload).toContain(publicPassId);
  });

  it("does not expose sensitive fields", async () => {
    const res  = await passGET();
    const json = await res.json() as Record<string, unknown>;
    const keys = Object.keys(json);

    expect(keys).not.toContain("email");
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("password");
    expect(keys).not.toContain("serviceKey");
    expect(keys).not.toContain("walletPrivateKey");
    expect(keys).not.toContain("expiresAt");   // no expiry — ID is stable
  });

  it("creates a new row when none exists and still returns publicPassId", async () => {
    mockPassExists = false;
    const res  = await passGET();
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(typeof json.publicPassId).toBe("string");
  });
});

// ── GET /api/me/pass/resolve ──────────────────────────────────────────────────
describe("GET /api/me/pass/resolve", () => {
  beforeEach(() => { mockPassExists = true; vi.clearAllMocks(); });

  it("returns 401 when Authorization header is missing", async () => {
    const req = new Request(`http://localhost/api/me/pass/resolve?passId=${KNOWN_PASS_ID}`);
    const res = await resolveGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer key is wrong", async () => {
    const res = await resolveGET(resolveRequest(KNOWN_PASS_ID, "wrong-key"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when passId param is absent", async () => {
    const req = new Request("http://localhost/api/me/pass/resolve", {
      headers: { Authorization: "Bearer test-platform-key" },
    });
    const res = await resolveGET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when passId is not found", async () => {
    mockPassExists = false;
    const res = await resolveGET(resolveRequest("00000000-0000-0000-0000-000000000000"));
    expect(res.status).toBe(404);
  });

  it("returns safe identity fields for a known passId", async () => {
    const res  = await resolveGET(resolveRequest(KNOWN_PASS_ID));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.identityType).toBe("email");
    expect(json.identityValue).toBe("alice@example.com");
    expect(typeof json.displayLabel).toBe("string");
    expect(typeof json.userId).toBe("string");
  });

  it("response has no expiry field (stable ID never expires)", async () => {
    const res  = await resolveGET(resolveRequest(KNOWN_PASS_ID));
    const json = await res.json() as Record<string, unknown>;
    expect(json).not.toHaveProperty("expiresInSeconds");
    expect(json).not.toHaveProperty("expiresAt");
  });

  it("response does not contain credentials or service secrets", async () => {
    const res  = await resolveGET(resolveRequest(KNOWN_PASS_ID));
    const body = JSON.stringify(await res.json());

    expect(body).not.toContain("privateKey");
    expect(body).not.toContain("serviceKey");
    expect(body).not.toContain("password");
    expect(body).not.toContain("SUPABASE_SERVICE");
    expect(body).not.toContain("AKIBA_API_KEY");
  });
});

// ── POST /api/me/pass/regenerate ─────────────────────────────────────────────
describe("POST /api/me/pass/regenerate", () => {
  beforeEach(() => { mockPassExists = true; vi.clearAllMocks(); });

  it("returns 200 with new publicPassId and qrPayload", async () => {
    const res  = await regeneratePOST();
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(typeof json.publicPassId).toBe("string");
    expect(typeof json.qrPayload).toBe("string");
  });

  it("qrPayload starts with akiba-pass:v1:", async () => {
    const res  = await regeneratePOST();
    const { qrPayload } = await res.json() as { qrPayload: string };
    expect(qrPayload).toMatch(/^akiba-pass:v1:/);
  });

  it("does not expose sensitive fields in response", async () => {
    const res  = await regeneratePOST();
    const json = await res.json() as Record<string, unknown>;
    const keys = Object.keys(json);

    expect(keys).not.toContain("email");
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("password");
    expect(keys).not.toContain("serviceKey");
  });
});
