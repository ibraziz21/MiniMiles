import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  detailJson: null as unknown,
  templates: [] as unknown[],
  availableIds: [] as string[],
  restrictions: [] as Array<{ template_id: string; location_id: string }>,
  savedRow: null as { id: string } | null,
  savedList: [] as Array<{ created_at: string; partners: { id: string; slug: string; name: string; image_url: string | null } }>,
  upsertError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
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
      return Promise.resolve({ data: state.detailJson, error: null });
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
    if (table === "hub_user_saved_merchants") {
      return {
        // isMerchantSaved: select().eq().eq().maybeSingle()
        // listSavedMerchants: select().eq().eq().order().limit()
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.savedRow, error: null }),
              order: () => ({
                limit: async () => ({ data: state.savedList, error: null }),
              }),
            }),
          }),
        }),
        upsert: async () => ({ error: state.upsertError }),
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: state.deleteError }),
          }),
        }),
      };
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

const { GET, POST, DELETE } = await import("@/app/api/merchants/[slug]/save/route");
const { GET: GET_LIST } = await import("@/app/api/merchants/saved/route");

function slugReq(slug: string) {
  return { req: new Request(`http://localhost/api/merchants/${slug}/save`), params: { slug } };
}

describe("merchant save/unsave/list routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
    state.detailJson = null;
    state.templates = [];
    state.availableIds = [];
    state.restrictions = [];
    state.savedRow = null;
    state.savedList = [];
    state.upsertError = null;
    state.deleteError = null;
    setupAdmin();
  });

  describe("GET /api/merchants/[slug]/save", () => {
    it("requires auth", async () => {
      const { req, params } = slugReq("acme");
      const res = await GET(req, { params });
      expect(res.status).toBe(401);
    });

    it("returns 404 for a merchant that doesn't resolve (draft/hidden/nonexistent)", async () => {
      state.user = { id: "u1" };
      state.detailJson = null;
      const { req, params } = slugReq("nope");
      const res = await GET(req, { params });
      expect(res.status).toBe(404);
    });

    it("reports saved: false when no row exists", async () => {
      state.user = { id: "u1" };
      state.detailJson = baseDetail();
      state.savedRow = null;
      const { req, params } = slugReq("acme");
      const res = await GET(req, { params });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.saved).toBe(false);
    });

    it("reports saved: true when a row exists", async () => {
      state.user = { id: "u1" };
      state.detailJson = baseDetail();
      state.savedRow = { id: "row-1" };
      const { req, params } = slugReq("acme");
      const res = await GET(req, { params });
      const body = await res.json();
      expect(body.saved).toBe(true);
    });
  });

  describe("POST /api/merchants/[slug]/save", () => {
    it("requires auth", async () => {
      const { req, params } = slugReq("acme");
      const res = await POST(req, { params });
      expect(res.status).toBe(401);
    });

    it("saves the resolved merchant and returns saved: true", async () => {
      state.user = { id: "u1" };
      state.detailJson = baseDetail();
      const { req, params } = slugReq("acme");
      const res = await POST(req, { params });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.saved).toBe(true);
    });
  });

  describe("DELETE /api/merchants/[slug]/save", () => {
    it("unsaves the resolved merchant and returns saved: false", async () => {
      state.user = { id: "u1" };
      state.detailJson = baseDetail();
      const { req, params } = slugReq("acme");
      const res = await DELETE(req, { params });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.saved).toBe(false);
    });
  });

  describe("GET /api/merchants/saved", () => {
    it("requires auth", async () => {
      const res = await GET_LIST();
      expect(res.status).toBe(401);
    });

    it("returns the signed-in user's saved merchants", async () => {
      state.user = { id: "u1" };
      state.savedList = [
        { created_at: "2026-01-01T00:00:00Z", partners: { id: "m1", slug: "acme", name: "Acme", image_url: null } },
      ];
      const res = await GET_LIST();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.merchants).toEqual([
        { id: "m1", slug: "acme", name: "Acme", logoUrl: null, savedAt: "2026-01-01T00:00:00Z" },
      ]);
    });
  });
});
