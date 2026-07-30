import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  summaryRows: [] as unknown[],
  summaryError: null as { message: string } | null,
  templates: [] as unknown[],
  availableIds: [] as string[],
  lastListRpcArgs: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// Enrichment (top offers, MerchantValueCard mapping, signed-in balance) is
// covered by its own unit tests (lib/merchants/enrich.test.ts) — mocked here
// so this route test only exercises param handling/dispatch/error-shape,
// and doesn't need to also stub resolveHubProfile/getUserBalance.
vi.mock("@/lib/merchants/enrich", () => ({
  getTopOffers: async () => ({}),
  getSignedInBalance: async () => null,
  toMerchantValueSummary: (
    m: { id: string },
    _offer: unknown,
    _balance: unknown,
    _intentLabel: unknown,
    voucherCount?: number
  ) => ({ id: m.id, voucherCount, reasons: [] }),
}));

function setupAdmin() {
  mockRpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "list_public_merchants") {
      state.lastListRpcArgs = args;
      return Promise.resolve({ data: state.summaryError ? null : state.summaryRows, error: state.summaryError });
    }
    if (name === "list_available_voucher_template_ids_hub") {
      return Promise.resolve({ data: state.availableIds.map((id) => ({ template_id: id })), error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "spend_voucher_templates") {
      return {
        select: () => ({
          in: () => ({
            eq: async () => ({ data: state.templates, error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "merchant-1", slug: "acme", name: "Acme", short_description: null, logo_url: null,
    primary_category: null, categories: [], operating_model: "physical",
    primary_location: null, branch_count: 1, voucher_count: 3, store_active: false,
    distance_km: null,
    ...overrides,
  };
}

const { GET } = await import("@/app/api/merchants/route");

describe("GET /api/merchants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
    state.summaryRows = [];
    state.summaryError = null;
    state.templates = [];
    state.availableIds = [];
    state.lastListRpcArgs = null;
    setupAdmin();
  });

  it("passes through search/category/city/mode params to the RPC", async () => {
    state.summaryRows = [row()];
    await GET(new Request("http://localhost/api/merchants?q=coffee&category=food_drink&city=Nairobi&mode=physical"));

    expect(state.lastListRpcArgs).toMatchObject({
      p_q: "coffee",
      p_category: "food_drink",
      p_city: "Nairobi",
      p_mode: "physical",
    });
  });

  it("rejects out-of-range coordinates with 400 before hitting the RPC", async () => {
    const res = await GET(new Request("http://localhost/api/merchants?lat=999&lng=0"));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects partial coordinates and a radius without coordinates", async () => {
    const partial = await GET(new Request("http://localhost/api/merchants?lat=-1.28"));
    const radiusOnly = await GET(new Request("http://localhost/api/merchants?radius_km=10"));

    expect(partial.status).toBe(400);
    expect(radiusOnly.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown operating mode", async () => {
    const res = await GET(new Request("http://localhost/api/merchants?mode=warehouse"));

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("passes a validated radius to the database contract", async () => {
    state.summaryRows = [row({ id: "with-coords", slug: "with-coords", distance_km: 2.4 })];
    const res = await GET(new Request("http://localhost/api/merchants?lat=-1.28&lng=36.8&radius_km=10"));

    expect(res.status).toBe(200);
    expect(state.lastListRpcArgs).toMatchObject({
      p_lat: -1.28,
      p_lng: 36.8,
      p_radius_km: 10,
    });
  });

  it("returns 400 for a malformed cursor instead of silently restarting pagination", async () => {
    const res = await GET(new Request("http://localhost/api/merchants?cursor=not-a-cursor"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_cursor");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("replaces voucherCount with canonical availability, not the RPC's active+unexpired count", async () => {
    state.summaryRows = [row({ id: "m1", slug: "m1", voucher_count: 5 })];
    state.templates = [{ id: "tpl-1", partner_id: "m1" }, { id: "tpl-2", partner_id: "m1" }];
    state.availableIds = ["tpl-1"]; // only one is canonically available

    const res = await GET(new Request("http://localhost/api/merchants"));
    const body = await res.json();

    expect(body.merchants[0].voucherCount).toBe(1);
  });

  it("personalizes canonical availability for a signed-in user", async () => {
    state.user = { id: "hub-user-1" };
    state.summaryRows = [row({ id: "m1", slug: "m1" })];

    await GET(new Request("http://localhost/api/merchants"));

    const availabilityCall = mockRpc.mock.calls.find((c) => c[0] === "list_available_voucher_template_ids_hub");
    expect(availabilityCall?.[1]).toEqual({ p_hub_user_id: "hub-user-1" });
  });

  it("never leaks the raw RPC/DB error in the response body", async () => {
    state.summaryError = { message: "relation does not exist: list_public_merchants" };

    const res = await GET(new Request("http://localhost/api/merchants"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("relation");
    expect(body.error).toBe("directory_unavailable");
  });
});
