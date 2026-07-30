import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  detailJson: null as unknown,
  detailError: null as { message: string } | null,
  templates: [] as unknown[],
  availableIds: [] as string[],
  restrictions: [] as Array<{ template_id: string; location_id: string }>,
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

function setupAdmin() {
  mockRpc.mockImplementation((name: string) => {
    if (name === "get_public_merchant") {
      return Promise.resolve({ data: state.detailError ? null : state.detailJson, error: state.detailError });
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
          eq: () => ({
            eq: () => ({
              order: async () => ({ data: state.templates, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "voucher_template_locations") {
      return { select: async () => ({ data: state.restrictions, error: null }) };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

function baseDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "merchant-1", slug: "acme", name: "Acme", shortDescription: null, description: null,
    logoUrl: null, bannerUrl: null, websiteUrl: null, operatingModel: "physical", storeActive: false,
    contacts: { phone: null, email: null, whatsapp: null, instagram: null, facebook: null },
    primaryCategory: null, categories: [], coreOfferings: [], locations: [], products: [],
    ...overrides,
  };
}

const { GET } = await import("@/app/api/merchants/[slug]/route");

function req(slug: string) {
  return { req: new Request(`http://localhost/api/merchants/${slug}`), params: { slug } };
}

describe("GET /api/merchants/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
    state.detailJson = null;
    state.detailError = null;
    state.templates = [];
    state.availableIds = [];
    state.restrictions = [];
    setupAdmin();
  });

  it("returns 404 for draft/paused/suspended/inactive/hidden merchants (RPC returns null)", async () => {
    state.detailJson = null;
    const { req: request, params } = req("draft-merchant");

    const res = await GET(request, { params });

    expect(res.status).toBe(404);
  });

  it("returns a published store_active=false (in-store-only) merchant successfully", async () => {
    state.detailJson = baseDetail({ storeActive: false, products: [] });
    const { req: request, params } = req("acme");

    const res = await GET(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.merchant.storeActive).toBe(false);
    expect(body.merchant.products).toEqual([]);
  });

  it("applies anonymous general availability when no session user is present", async () => {
    state.user = null;
    state.detailJson = baseDetail();
    state.templates = [{ id: "tpl-1", title: "t", voucher_type: "free", miles_cost: 10,
      discount_percent: null, discount_cusd: null, applicable_category: null,
      linked_product_id: null, retail_value_cusd: null, cooldown_seconds: 60, global_cap: null, expires_at: null }];
    state.availableIds = ["tpl-1"];

    const { req: request, params } = req("acme");
    await GET(request, { params });

    const availabilityCall = mockRpc.mock.calls.find((c) => c[0] === "list_available_voucher_template_ids_hub");
    expect(availabilityCall?.[1]).toEqual({ p_hub_user_id: null });
  });

  it("applies signed-in-user cooldown by passing the session user id, never a cached anonymous result", async () => {
    state.user = { id: "hub-user-42" };
    state.detailJson = baseDetail();

    const { req: request, params } = req("acme");
    await GET(request, { params });

    const availabilityCall = mockRpc.mock.calls.find((c) => c[0] === "list_available_voucher_template_ids_hub");
    expect(availabilityCall?.[1]).toEqual({ p_hub_user_id: "hub-user-42" });
  });

  it("never leaks the raw RPC/DB error in the response body", async () => {
    state.detailError = { message: "password authentication failed for user \"service_role\"" };
    const { req: request, params } = req("acme");

    const res = await GET(request, { params });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("password");
    expect(body.error).toBe("directory_unavailable");
  });
});
