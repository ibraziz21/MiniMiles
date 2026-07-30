import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summaryRows: [] as unknown[],
  summaryError: null as { message: string } | null,
  detailJson: null as unknown,
  detailError: null as { message: string } | null,
  templates: [] as unknown[],
  availableIds: [] as string[],
  restrictions: [] as Array<{ template_id: string; location_id: string }>,
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

function setupAdmin() {
  mockRpc.mockImplementation((name: string) => {
    if (name === "list_public_merchants") {
      return Promise.resolve({ data: state.summaryError ? null : state.summaryRows, error: state.summaryError });
    }
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
          in: () => ({
            eq: async () => ({ data: state.templates, error: null }),
          }),
        }),
      };
    }
    if (table === "voucher_template_locations") {
      return {
        select: async () => ({ data: state.restrictions, error: null }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

const { listPublicMerchants, getPublicMerchant, getCanonicalVoucherCounts, DirectoryUnavailableError } =
  await import("@/lib/merchants/queries");

const FORBIDDEN_SUBSTRINGS = [
  "wallet_address",
  "walletAddress",
  "support_email",
  "supportEmail",
  "staff_notes",
  "payout",
];

function baseSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "merchant-1",
    slug: "acme",
    name: "Acme",
    short_description: "Great stuff",
    logo_url: null,
    primary_category: { slug: "food_drink", name: "Food & Drink" },
    categories: [{ slug: "food_drink", name: "Food & Drink" }],
    operating_model: "physical",
    primary_location: { id: "loc-1", locality: "Westlands", city: "Nairobi", latitude: null, longitude: null },
    branch_count: 1,
    voucher_count: 3,
    store_active: false,
    distance_km: null,
    ...overrides,
  };
}

function baseDetailJson(overrides: Record<string, unknown> = {}) {
  return {
    id: "merchant-1",
    slug: "acme",
    name: "Acme",
    shortDescription: "Great stuff",
    description: "Full description",
    logoUrl: null,
    bannerUrl: null,
    websiteUrl: null,
    operatingModel: "physical",
    storeActive: false,
    contacts: { phone: null, email: null, whatsapp: null, instagram: null, facebook: null },
    primaryCategory: { slug: "food_drink", name: "Food & Drink" },
    categories: [],
    coreOfferings: [],
    locations: [
      {
        id: "loc-1", name: "Main", locationType: "store", addressLine1: "1 Main St",
        city: "Nairobi", countryCode: "KE", timezone: "Africa/Nairobi", openingHours: {},
        isPrimary: true, acceptsAkibaPass: true, acceptsVouchers: true,
      },
    ],
    products: [],
    ...overrides,
  };
}

describe("listPublicMerchants — public-data safety and pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.summaryRows = [];
    state.summaryError = null;
    setupAdmin();
  });

  it("never surfaces forbidden fields, even if the RPC row carries them", async () => {
    state.summaryRows = [
      baseSummaryRow({
        // Simulates a future RPC regression leaking internal fields.
        wallet_address: "0xsecret",
        support_email: "internal@acme.test",
        staff_notes: "do not trust this customer",
      }),
    ];

    const result = await listPublicMerchants({ limit: 20 });
    const serialized = JSON.stringify(result.merchants[0]);

    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(result.merchants[0])).toEqual([
      "id", "slug", "name", "shortDescription", "logoUrl", "primaryCategory",
      "categories", "operatingModel", "primaryLocation", "branchCount",
      "voucherCount", "storeActive", "distanceKm",
    ]);
  });

  it("over-fetches by one row to compute next_cursor without the fragile full-page heuristic", async () => {
    state.summaryRows = [
      baseSummaryRow({ id: "m1", slug: "m1", name: "Alpha" }),
      baseSummaryRow({ id: "m2", slug: "m2", name: "Beta" }),
      baseSummaryRow({ id: "m3", slug: "m3", name: "Gamma" }), // the +1 overfetch row
    ];

    const result = await listPublicMerchants({ limit: 2 });

    expect(result.merchants).toHaveLength(2);
    expect(result.next_cursor).not.toBeNull();
  });

  it("returns a null cursor when there is no extra row (no next page)", async () => {
    state.summaryRows = [baseSummaryRow({ id: "m1", slug: "m1", name: "Alpha" })];

    const result = await listPublicMerchants({ limit: 2 });

    expect(result.merchants).toHaveLength(1);
    expect(result.next_cursor).toBeNull();
  });

  it("round-trips an opaque cursor and passes only the name through to the RPC", async () => {
    state.summaryRows = [
      baseSummaryRow({ id: "m1", slug: "m1", name: "Alpha" }),
      baseSummaryRow({ id: "m2", slug: "m2", name: "Beta" }),
    ];
    const first = await listPublicMerchants({ limit: 1 });
    expect(first.next_cursor).not.toBeNull();

    await listPublicMerchants({ limit: 1, cursor: first.next_cursor! });

    const secondCallArgs = mockRpc.mock.calls[1][1] as { p_cursor: string | null };
    expect(secondCallArgs.p_cursor).toBe("Alpha");
  });

  it("wraps an RPC error in a sanitized DirectoryUnavailableError, never leaking the DB message", async () => {
    state.summaryError = { message: "relation \"list_public_merchants\" does not exist" };

    await expect(listPublicMerchants({ limit: 20 })).rejects.toBeInstanceOf(DirectoryUnavailableError);
  });

  it("throws on an unrecognized row shape instead of silently mis-mapping", async () => {
    state.summaryRows = [{ unexpected: "shape" }];

    await expect(listPublicMerchants({ limit: 20 })).rejects.toBeInstanceOf(DirectoryUnavailableError);
  });
});

describe("getPublicMerchant — voucher branch-restriction correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.detailJson = null;
    state.detailError = null;
    state.templates = [];
    state.availableIds = [];
    state.restrictions = [];
    setupAdmin();
  });

  it("returns null for a merchant the RPC hides (draft/suspended/inactive/hidden)", async () => {
    state.detailJson = null;
    const merchant = await getPublicMerchant("some-slug", null);
    expect(merchant).toBeNull();
  });

  it("drops a voucher whose branch restriction resolves to zero valid branches", async () => {
    state.detailJson = baseDetailJson({
      locations: [
        {
          id: "loc-1", name: "Main", locationType: "store", addressLine1: "1 Main St",
          city: "Nairobi", countryCode: "KE", timezone: "Africa/Nairobi", openingHours: {},
          isPrimary: true, acceptsAkibaPass: true, acceptsVouchers: false, // does not accept vouchers
        },
      ],
    });
    state.templates = [
      { id: "tpl-1", title: "10% off", voucher_type: "percent_off", miles_cost: 50,
        discount_percent: 10, discount_cusd: null, applicable_category: null,
        linked_product_id: null, retail_value_cusd: null, cooldown_seconds: 0,
        global_cap: null, expires_at: null },
    ];
    state.availableIds = ["tpl-1"];
    state.restrictions = [{ template_id: "tpl-1", location_id: "loc-1" }];

    const merchant = await getPublicMerchant("acme", null);

    expect(merchant!.vouchers).toHaveLength(0);
  });

  it("keeps a voucher restricted to a valid, voucher-accepting branch owned by the merchant", async () => {
    state.detailJson = baseDetailJson();
    state.templates = [
      { id: "tpl-1", title: "10% off", voucher_type: "percent_off", miles_cost: 50,
        discount_percent: 10, discount_cusd: null, applicable_category: null,
        linked_product_id: null, retail_value_cusd: null, cooldown_seconds: 0,
        global_cap: null, expires_at: null },
    ];
    state.availableIds = ["tpl-1"];
    state.restrictions = [{ template_id: "tpl-1", location_id: "loc-1" }];

    const merchant = await getPublicMerchant("acme", null);

    expect(merchant!.vouchers).toHaveLength(1);
    expect(merchant!.vouchers[0].branchIds).toEqual(["loc-1"]);
  });

  it("ignores a restriction row pointing at a location not owned by this merchant", async () => {
    state.detailJson = baseDetailJson();
    state.templates = [
      { id: "tpl-1", title: "10% off", voucher_type: "percent_off", miles_cost: 50,
        discount_percent: 10, discount_cusd: null, applicable_category: null,
        linked_product_id: null, retail_value_cusd: null, cooldown_seconds: 0,
        global_cap: null, expires_at: null },
    ];
    state.availableIds = ["tpl-1"];
    state.restrictions = [{ template_id: "tpl-1", location_id: "someone-elses-location" }];

    const merchant = await getPublicMerchant("acme", null);

    // Zero valid branches after ownership filtering -> voucher is dropped.
    expect(merchant!.vouchers).toHaveLength(0);
  });

  it("excludes an active/unexpired template that canonical availability rejects (cap/cooldown/program state)", async () => {
    state.detailJson = baseDetailJson();
    state.templates = [
      { id: "tpl-1", title: "Capped offer", voucher_type: "free", miles_cost: 50,
        discount_percent: null, discount_cusd: null, applicable_category: null,
        linked_product_id: null, retail_value_cusd: null, cooldown_seconds: 0,
        global_cap: 10, expires_at: null },
    ];
    state.availableIds = []; // canonical RPC says unavailable (cap exhausted, program inactive, etc.)

    const merchant = await getPublicMerchant("acme", null);

    expect(merchant!.vouchers).toHaveLength(0);
  });

  it("never leaks the raw DB error when voucher availability lookup fails", async () => {
    state.detailJson = baseDetailJson();
    mockFrom.mockImplementation((table: string) => {
      if (table === "spend_voucher_templates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({ data: null, error: { message: "connection refused" } }),
              }),
            }),
          }),
        };
      }
      if (table === "voucher_template_locations") {
        return { select: async () => ({ data: [], error: null }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(getPublicMerchant("acme", null)).rejects.toBeInstanceOf(DirectoryUnavailableError);
  });
});

describe("getCanonicalVoucherCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.templates = [];
    state.availableIds = [];
    setupAdmin();
  });

  it("counts only canonically available templates per merchant, not all active/unexpired ones", async () => {
    state.templates = [
      { id: "tpl-1", partner_id: "m1" },
      { id: "tpl-2", partner_id: "m1" },
      { id: "tpl-3", partner_id: "m2" },
    ];
    state.availableIds = ["tpl-1", "tpl-3"]; // tpl-2 fails canonical availability

    const counts = await getCanonicalVoucherCounts(["m1", "m2"], null);

    expect(counts).toEqual({ m1: 1, m2: 1 });
  });

  it("returns an empty map without calling the DB for an empty merchant list", async () => {
    const counts = await getCanonicalVoucherCounts([], null);
    expect(counts).toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
