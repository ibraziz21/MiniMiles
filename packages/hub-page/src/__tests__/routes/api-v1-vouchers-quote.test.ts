import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer"; accessToken: string } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  template: {
    partner_id: "merchant-1",
    miles_cost: 100,
    active: true,
    expires_at: null,
  } as Record<string, unknown> | null,
  ledger: 100,
  available: true,
  memberCountry: null as string | null,
  merchantCountry: null as string | null,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: () =>
    Promise.resolve({ activeRow: null, walletAddress: null, displayName: "You", needsPicker: false, rows: [] }),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: async () => ({ expiredUnusedCount: 0, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: false }),
}));
vi.mock("@/lib/akiba/voucherUsername", () => ({
  getActiveUsernameForHubUser: async () => null,
}));

const { POST } = await import("@/app/api/v1/vouchers/quote/route");

function sameOriginReq(body: Record<string, unknown> = { template_id: "template-1" }) {
  return new Request("http://localhost/api/v1/vouchers/quote", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function crossOriginReq() {
  return new Request("http://localhost/api/v1/vouchers/quote", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ template_id: "template-1" }),
  });
}

function bearerReq(contentType = "application/json") {
  return new Request("http://localhost/api/v1/vouchers/quote", {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify({ template_id: "template-1" }),
  });
}

function setupAdmin() {
  mockRpc.mockImplementation((name: string) => {
    if (name === "list_available_voucher_template_ids_hub") {
      return Promise.resolve({
        data: state.available ? [{ template_id: "template-1" }] : [],
        error: null,
      });
    }
    if (name === "resolve_canonical_ids") {
      return Promise.resolve({ data: ["canonical-1"], error: null });
    }
    if (name === "available_ledger_points") {
      return Promise.resolve({ data: state.ledger, error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "spend_voucher_templates") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.template, error: null }),
          }),
        }),
      };
    }
    if (table === "hub_user_profiles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { country: state.memberCountry }, error: null }),
          }),
        }),
      };
    }
    if (table === "partners") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { country: state.merchantCountry }, error: null }),
          }),
        }),
      };
    }
    if (table === "hub_user_wallets") {
      return {
        select: () => {
          const node: { eq: () => typeof node; order: () => Promise<unknown> } = {
            eq: () => node,
            order: async () => ({ data: [], error: null }),
          };
          return node;
        },
      };
    }
    if (table === "minipoint_burn_jobs") {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }),
      };
    }
    if (table === "voucher_purchase_quotes") {
      return {
        insert: (values: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({
              data: {
                id: "quote-1",
                ledger_points: values.ledger_points,
                onchain_points: values.onchain_points,
                total_points: values.total_points,
                disclosure_version: values.disclosure_version,
                wallet_address: values.wallet_address,
              },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

describe("POST /api/v1/vouchers/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.template = { partner_id: "merchant-1", miles_cost: 100, active: true, expires_at: null };
    state.ledger = 100;
    state.available = true;
    state.memberCountry = null;
    state.merchantCountry = null;
    setupAdmin();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(sameOriginReq());
    expect(res.status).toBe(401);
  });

  it("rejects a cookie-authenticated cross-origin mutation with 403", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "cookie", accessToken: "t1" };
    const res = await POST(crossOriginReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("rejects a bearer-authenticated mutation with the wrong content type", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer", accessToken: "t1" };
    const res = await POST(bearerReq("text/plain"));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("creates a walletless ledger-only quote for a bearer actor", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    const res = await POST(bearerReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.ledgerPoints).toBe(100);
    expect(body.data.onchainPoints).toBe(0);
    expect(body.data.walletAddress).toBeNull();
    expect(body.data.claimFriction).toEqual(expect.objectContaining({ requiresUsePlan: false }));
  });

  it("rejects an insufficient ledger balance with INSUFFICIENT_MILES", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    state.ledger = 40;
    const res = await POST(sameOriginReq());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("INSUFFICIENT_MILES");
  });

  it("does not quote catalog inventory that reservation would reject", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    state.available = false;
    const res = await POST(sameOriginReq());
    expect(res.status).toBe(409);
  });

  it("rejects a quote when the member's and merchant's countries are both known and differ", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    state.memberCountry = "Kenya";
    state.merchantCountry = "UG";
    const res = await POST(sameOriginReq());
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unresolvable template", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    state.template = null;
    const res = await POST(sameOriginReq());
    expect(res.status).toBe(404);
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    const res = await POST(sameOriginReq());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
