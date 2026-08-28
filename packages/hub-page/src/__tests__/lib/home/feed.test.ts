import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMerchantSummary } from "@/lib/merchants/types";

const state = vi.hoisted(() => ({
  merchants: [] as PublicMerchantSummary[],
  nearbyMerchants: [] as PublicMerchantSummary[],
  templates: [] as unknown[],
  availableIds: [] as string[],
  limitedTimeShouldError: false,
  balance: 0,
  hasPass: true,
  activeVoucherCount: 0,
  linkedAddresses: [] as string[],
  completedPartnerIds: [] as string[],
}));

const mockListPublicMerchants = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  listPublicMerchants: (...args: unknown[]) => mockListPublicMerchants(...args),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

const mockGetUserBalance = vi.fn();
vi.mock("@/lib/akiba/balance", () => ({
  getUserBalance: (...args: unknown[]) => mockGetUserBalance(...args),
}));

const mockResolveHubProfile = vi.fn();
vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: (...args: unknown[]) => mockResolveHubProfile(...args),
}));

const mockGetOrCreatePass = vi.fn();
vi.mock("@/lib/akiba/pass", () => ({
  getOrCreatePass: (...args: unknown[]) => mockGetOrCreatePass(...args),
}));

const mockGetActiveVoucherSummary = vi.fn();
const mockGetLinkedWalletAddresses = vi.fn();
vi.mock("@/lib/akiba/myVouchers", () => ({
  getActiveVoucherSummary: (...args: unknown[]) => mockGetActiveVoucherSummary(...args),
  getLinkedWalletAddresses: (...args: unknown[]) => mockGetLinkedWalletAddresses(...args),
}));

/** Any chained call (`.select().eq().gt()...`) returns itself; awaiting it
 *  resolves to `result` — avoids hand-replicating every query-builder chain
 *  shape used inside feed.ts's direct table reads. */
function chainable(result: unknown): any {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function merchant(overrides: Partial<PublicMerchantSummary> = {}): PublicMerchantSummary {
  return {
    id: "m1", slug: "m1", name: "Alpha", shortDescription: null, logoUrl: null,
    primaryCategory: null, categories: [], operatingModel: "physical",
    primaryLocation: null, branchCount: 1, voucherCount: 0, storeActive: false,
    distanceKm: null,
    ...overrides,
  };
}

function setupAdmin() {
  mockRpc.mockImplementation((name: string) => {
    if (name === "list_available_voucher_template_ids_hub") {
      return Promise.resolve({ data: state.availableIds.map((id) => ({ template_id: id })), error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "spend_voucher_templates") {
      if (state.limitedTimeShouldError) {
        return chainable({ data: null, error: { message: "connection refused" } });
      }
      return chainable({ data: state.templates, error: null });
    }
    if (table === "merchant_transactions") {
      return chainable({ data: state.completedPartnerIds.map((id) => ({ partner_id: id })), error: null });
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

const { getHomeFeed } = await import("@/lib/home/feed");

describe("getHomeFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.merchants = [];
    state.nearbyMerchants = [];
    state.templates = [];
    state.availableIds = [];
    state.limitedTimeShouldError = false;
    state.balance = 0;
    state.hasPass = true;
    state.activeVoucherCount = 0;
    state.linkedAddresses = [];
    state.completedPartnerIds = [];
    setupAdmin();

    mockListPublicMerchants.mockImplementation((params: { lat?: number; lng?: number }) => {
      if (params.lat != null && params.lng != null) {
        return Promise.resolve({ merchants: state.nearbyMerchants, next_cursor: null, applied: { category: null, city: null, nearby: true } });
      }
      return Promise.resolve({ merchants: state.merchants, next_cursor: null, applied: { category: null, city: null, nearby: false } });
    });
    mockGetUserBalance.mockImplementation(async () => ({ chainBalance: 0, ledgerBalance: state.balance, balance: state.balance, hasBalance: true }));
    mockResolveHubProfile.mockResolvedValue({ rows: [], activeRow: null, walletAddress: null, displayName: "Test", needsPicker: false });
    mockGetOrCreatePass.mockImplementation(async () => ({ publicPassId: state.hasPass ? "pass-1" : null, isNew: false }));
    mockGetLinkedWalletAddresses.mockImplementation(async () => state.linkedAddresses);
    mockGetActiveVoucherSummary.mockImplementation(async () => ({ activeCount: state.activeVoucherCount, expiringSoonCount: 0 }));
  });

  it("signed-out: rewards is null and balance/voucher helpers are never called", async () => {
    state.merchants = [merchant()];

    const feed = await getHomeFeed({ userId: null });

    expect(feed.rewards).toBeNull();
    expect(mockGetUserBalance).not.toHaveBeenCalled();
    expect(mockGetActiveVoucherSummary).not.toHaveBeenCalled();
  });

  it("signed-in: rewards reflects balance, pass, and active voucher count", async () => {
    state.balance = 500;
    state.hasPass = true;
    state.activeVoucherCount = 2;
    state.merchants = [merchant()];

    const feed = await getHomeFeed({ userId: "user-1", userEmail: "u@test.com" });

    expect(feed.rewards).toEqual({ milesBalance: 500, activeVoucherCount: 2, hasPass: true });
  });

  it("cold-start (no intent, no location) orders for_you by offer presence then cheapest cost then name", async () => {
    state.merchants = [
      merchant({ id: "no-offer", slug: "no-offer", name: "Zebra Shop" }),
      merchant({ id: "cheap-offer", slug: "cheap-offer", name: "Beta Shop" }),
      merchant({ id: "pricier-offer", slug: "pricier-offer", name: "Alpha Shop" }),
    ];
    state.templates = [
      { id: "tpl-cheap", partner_id: "cheap-offer", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 20, expires_at: null },
      { id: "tpl-pricier", partner_id: "pricier-offer", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 80, expires_at: null },
    ];
    state.availableIds = ["tpl-cheap", "tpl-pricier"];

    const feed = await getHomeFeed({ userId: null });
    const forYou = feed.sections.find((s) => s.id === "for_you");

    expect(forYou?.merchants.map((m) => m.id)).toEqual(["cheap-offer", "pricier-offer", "no-offer"]);
    expect(forYou?.personalized).toBe(false);
    expect(forYou?.title).toBe("Places to explore");
  });

  it("never emits an unsupported reason kind (earn/availability/new)", async () => {
    state.merchants = [merchant({ primaryLocation: { id: "loc-1", locality: "CBD", city: "Nairobi", latitude: -1.28, longitude: 36.8 } })];
    state.templates = [
      { id: "tpl-1", partner_id: "m1", title: "t", voucher_type: "free", discount_percent: null, discount_cusd: null, miles_cost: 10, expires_at: null },
    ];
    state.availableIds = ["tpl-1"];

    const feed = await getHomeFeed({ userId: null });
    const allReasons = feed.sections.flatMap((s) => s.merchants.flatMap((m) => m.reasons.map((r) => r.kind)));

    for (const kind of allReasons) {
      expect(["intent", "distance", "voucher", "affordable", "affinity"]).toContain(kind);
    }
  });

  it("cold-start: a verified previous purchase outranks a cheaper competing offer", async () => {
    state.merchants = [
      merchant({ id: "cheap-stranger", slug: "cheap-stranger", name: "Alpha Shop" }),
      merchant({ id: "purchased-before", slug: "purchased-before", name: "Zebra Shop" }),
    ];
    state.templates = [
      { id: "tpl-cheap", partner_id: "cheap-stranger", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 10, expires_at: null },
      { id: "tpl-pricier", partner_id: "purchased-before", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 90, expires_at: null },
    ];
    state.availableIds = ["tpl-cheap", "tpl-pricier"];
    state.linkedAddresses = ["0xabc"];
    state.completedPartnerIds = ["purchased-before"];

    const feed = await getHomeFeed({ userId: "user-1" });
    const forYou = feed.sections.find((s) => s.id === "for_you");

    expect(forYou?.merchants.map((m) => m.id)).toEqual(["purchased-before", "cheap-stranger"]);
    expect(forYou?.personalized).toBe(true);
    const purchasedCard = forYou?.merchants.find((m) => m.id === "purchased-before");
    expect(purchasedCard?.reasons[0]).toEqual({ kind: "affinity", label: "You've shopped here before" });
  });

  it("does not mark for_you personalized/does not emit an affinity reason for a signed-in user with no purchase history", async () => {
    state.merchants = [merchant()];
    state.linkedAddresses = ["0xabc"];
    state.completedPartnerIds = []; // no completed purchases anywhere

    const feed = await getHomeFeed({ userId: "user-1" });
    const forYou = feed.sections.find((s) => s.id === "for_you");

    expect(forYou?.personalized).toBe(false);
    expect(forYou?.merchants[0].reasons.some((r) => r.kind === "affinity")).toBe(false);
  });

  it("omits the nearby section entirely when no merchants have valid coordinates", async () => {
    state.merchants = [merchant()];
    state.nearbyMerchants = [];

    const feed = await getHomeFeed({ userId: null, lat: -1.28, lng: 36.8 });

    expect(feed.sections.find((s) => s.id === "nearby")).toBeUndefined();
  });

  it("includes a populated nearby section when coordinates are given and merchants are found", async () => {
    state.merchants = [merchant()];
    state.nearbyMerchants = [merchant({ id: "near-1", slug: "near-1", distanceKm: 2.1 })];

    const feed = await getHomeFeed({ userId: null, lat: -1.28, lng: 36.8 });
    const nearby = feed.sections.find((s) => s.id === "nearby");

    expect(nearby).toBeDefined();
    expect(nearby?.merchants[0].id).toBe("near-1");
  });

  it("limited_time carries the merchant's uploaded banner through to bannerUrl", async () => {
    state.merchants = [merchant()];
    state.templates = [
      {
        id: "tpl-ltd", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null,
        miles_cost: 20, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        partners: {
          id: "banner-merchant", slug: "banner-merchant", name: "Banner Co", image_url: "https://logo.example/x.png",
          partner_settings: { directory_status: "published", banner_url: "https://cdn.example/banner.jpg" },
        },
      },
    ];
    state.availableIds = ["tpl-ltd"];

    const feed = await getHomeFeed({ userId: null });
    const limitedTime = feed.sections.find((s) => s.id === "limited_time");

    expect(limitedTime?.merchants[0].bannerUrl).toBe("https://cdn.example/banner.jpg");
    expect(limitedTime?.merchants[0].logoUrl).toBe("https://logo.example/x.png");
  });

  it("limited_time defaults bannerUrl to null when the merchant hasn't set one", async () => {
    state.merchants = [merchant()];
    state.templates = [
      {
        id: "tpl-ltd-2", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null,
        miles_cost: 20, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        partners: {
          id: "no-banner-merchant", slug: "no-banner-merchant", name: "No Banner Co", image_url: null,
          partner_settings: { directory_status: "published", banner_url: null },
        },
      },
    ];
    state.availableIds = ["tpl-ltd-2"];

    const feed = await getHomeFeed({ userId: null });
    const limitedTime = feed.sections.find((s) => s.id === "limited_time");

    expect(limitedTime?.merchants[0].bannerUrl).toBeNull();
  });

  it("isolates a failing section — limited_time erroring doesn't take down for_you", async () => {
    state.merchants = [merchant()];
    state.limitedTimeShouldError = true;

    const feed = await getHomeFeed({ userId: null });

    expect(feed.sections.find((s) => s.id === "for_you")).toBeDefined();
    expect(feed.sections.find((s) => s.id === "limited_time")).toBeUndefined();
  });

  it("never ships a popular or new-merchants section in Phase 1 (no analytics pipeline / no directory_published_at)", async () => {
    state.merchants = [merchant()];

    const feed = await getHomeFeed({ userId: null });

    expect(feed.sections.some((s) => s.id === "popular")).toBe(false);
    expect(feed.sections.some((s) => s.id === "new")).toBe(false);
  });
});
