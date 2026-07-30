import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMerchantSummary } from "@/lib/merchants/types";

const state = vi.hoisted(() => ({
  templates: [] as unknown[],
  availableIds: [] as string[],
  walletAddress: null as string | null,
  balance: 0,
  linkedAddresses: [] as string[],
  completedTransactions: [] as unknown[],
  transactionsError: null as { message: string } | null,
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

const mockResolveHubProfile = vi.fn();
vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: (...args: unknown[]) => mockResolveHubProfile(...args),
}));

const mockGetUserBalance = vi.fn();
vi.mock("@/lib/akiba/balance", () => ({
  getUserBalance: (...args: unknown[]) => mockGetUserBalance(...args),
}));

const mockGetLinkedWalletAddresses = vi.fn();
vi.mock("@/lib/akiba/myVouchers", () => ({
  getLinkedWalletAddresses: (...args: unknown[]) => mockGetLinkedWalletAddresses(...args),
}));

function setupAdmin() {
  mockRpc.mockImplementation((name: string) => {
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
            eq: () => ({
              order: async () => ({ data: state.templates, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "merchant_transactions") {
      return {
        select: () => ({
          in: () => ({
            eq: async () => ({
              data: state.transactionsError ? null : state.completedTransactions,
              error: state.transactionsError,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

const { getTopOffers, toMerchantValueSummary, getSignedInBalance, getPurchaseAffinity } = await import("@/lib/merchants/enrich");

function merchant(overrides: Partial<PublicMerchantSummary> = {}): PublicMerchantSummary {
  return {
    id: "m1", slug: "m1", name: "Acme", shortDescription: null, logoUrl: null,
    primaryCategory: null, categories: [], operatingModel: "physical",
    primaryLocation: null, branchCount: 1, voucherCount: 0, storeActive: false,
    distanceKm: null,
    ...overrides,
  };
}

describe("getTopOffers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.templates = [];
    state.availableIds = [];
    setupAdmin();
  });

  it("picks the cheapest canonically-available template per partner", async () => {
    state.templates = [
      { id: "cheap", partner_id: "m1", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 20, expires_at: null },
      { id: "pricier", partner_id: "m1", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 80, expires_at: null },
    ];
    state.availableIds = ["cheap", "pricier"];

    const offers = await getTopOffers(["m1"], null);

    expect(offers.m1.templateId).toBe("cheap");
    expect(offers.m1.milesCost).toBe(20);
  });

  it("excludes a cheaper template that fails canonical availability (cap/cooldown/program state)", async () => {
    state.templates = [
      { id: "cheap-but-capped", partner_id: "m1", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 20, expires_at: null },
      { id: "pricier-available", partner_id: "m1", title: "t", voucher_type: "percent_off", discount_percent: 10, discount_cusd: null, miles_cost: 80, expires_at: null },
    ];
    state.availableIds = ["pricier-available"];

    const offers = await getTopOffers(["m1"], null);

    expect(offers.m1.templateId).toBe("pricier-available");
  });

  it("returns an empty object without querying anything for an empty partner list", async () => {
    const offers = await getTopOffers([], null);
    expect(offers).toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("toMerchantValueSummary", () => {
  it("includes an intent reason with a truthful label when an intent/query is active", () => {
    const summary = toMerchantValueSummary(merchant(), undefined, null, "Burgers");
    expect(summary.reasons).toEqual([{ kind: "intent", label: "Matches Burgers" }]);
  });

  it("includes a distance reason when distanceKm is present", () => {
    const summary = toMerchantValueSummary(merchant({ distanceKm: 2.4 }), undefined, null, null);
    expect(summary.reasons).toEqual([{ kind: "distance", distanceKm: 2.4 }]);
  });

  it("includes an affordable reason only when signed in with enough balance", () => {
    const offer = { templateId: "tpl-1", label: "10% off", milesCost: 50, expiresAt: null };

    const noBalance = toMerchantValueSummary(merchant(), offer, null, null);
    expect(noBalance.reasons.some((r) => r.kind === "affordable")).toBe(false);

    const notEnough = toMerchantValueSummary(merchant(), offer, 10, null);
    expect(notEnough.reasons.some((r) => r.kind === "affordable")).toBe(false);

    const enough = toMerchantValueSummary(merchant(), offer, 100, null);
    expect(enough.reasons.some((r) => r.kind === "affordable")).toBe(true);
  });

  it("never emits an earn/availability/new reason (no backing data contract yet)", () => {
    const summary = toMerchantValueSummary(
      merchant({ distanceKm: 1, primaryLocation: { id: "l1", locality: "CBD", city: "Nairobi", latitude: 1, longitude: 1 } }),
      { templateId: "tpl-1", label: "Free item", milesCost: 10, expiresAt: null },
      100,
      "Coffee"
    );
    for (const r of summary.reasons) {
      expect(["intent", "distance", "voucher", "affordable", "affinity"]).toContain(r.kind);
    }
    expect(summary.earnSummary).toBeNull();
    expect(summary.nearestLocation?.openStatus).toBe("unknown");
  });

  it("includes a truthful affinity reason, only when hasAffinity is explicitly true", () => {
    const withAffinity = toMerchantValueSummary(merchant(), undefined, null, null, undefined, true);
    expect(withAffinity.reasons).toEqual([{ kind: "affinity", label: "You've shopped here before" }]);

    const withoutAffinity = toMerchantValueSummary(merchant(), undefined, null, null, undefined, false);
    expect(withoutAffinity.reasons.some((r) => r.kind === "affinity")).toBe(false);
  });

  it("carries voucherCount independently of topOffer", () => {
    const withBoth = toMerchantValueSummary(merchant(), { templateId: "t1", label: "10% off", milesCost: 20, expiresAt: null }, null, null, 5);
    expect(withBoth.voucherCount).toBe(5);
    expect(withBoth.topOffer?.templateId).toBe("t1");

    const countOnly = toMerchantValueSummary(merchant(), undefined, null, null, 3);
    expect(countOnly.voucherCount).toBe(3);
    expect(countOnly.topOffer).toBeNull();
  });
});

describe("getPurchaseAffinity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.linkedAddresses = [];
    state.completedTransactions = [];
    state.transactionsError = null;
    setupAdmin();
    mockGetLinkedWalletAddresses.mockImplementation(async () => state.linkedAddresses);
  });

  it("returns an empty set without looking up wallets when signed out", async () => {
    const affinity = await getPurchaseAffinity(null);
    expect(affinity.size).toBe(0);
    expect(mockGetLinkedWalletAddresses).not.toHaveBeenCalled();
  });

  it("returns an empty set when the user has no linked wallets", async () => {
    state.linkedAddresses = [];
    const affinity = await getPurchaseAffinity("user-1");
    expect(affinity.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("includes only partners with a completed transaction — not disputed/in-flight ones", async () => {
    state.linkedAddresses = ["0xabc"];
    // The mocked query already filters .eq("status","completed"); this
    // fixture represents what the DB would return for that filter.
    state.completedTransactions = [{ partner_id: "m1" }, { partner_id: "m2" }];

    const affinity = await getPurchaseAffinity("user-1");

    expect(affinity.has("m1")).toBe(true);
    expect(affinity.has("m2")).toBe(true);
    expect(affinity.has("m3")).toBe(false);
  });

  it("returns an empty set (never throws) when the lookup fails", async () => {
    state.linkedAddresses = ["0xabc"];
    state.transactionsError = { message: "connection refused" };

    const affinity = await getPurchaseAffinity("user-1");

    expect(affinity.size).toBe(0);
  });
});

describe("getSignedInBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.walletAddress = null;
    state.balance = 0;
    mockResolveHubProfile.mockImplementation(async () => ({ walletAddress: state.walletAddress }));
    mockGetUserBalance.mockImplementation(async () => ({ balance: state.balance }));
  });

  it("returns null without resolving a profile when signed out", async () => {
    const balance = await getSignedInBalance(null, null);
    expect(balance).toBeNull();
    expect(mockResolveHubProfile).not.toHaveBeenCalled();
  });

  it("returns the resolved balance when signed in", async () => {
    state.balance = 250;
    const balance = await getSignedInBalance("user-1", "u@test.com");
    expect(balance).toBe(250);
  });
});
