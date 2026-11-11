import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/merchants/publicOffers", () => ({ listPublicMerchantOffers: vi.fn() }));
vi.mock("@/lib/vouchers/catalogue.server", () => ({ getAllTemplates: vi.fn(), getFundedOffers: vi.fn() }));
const fundedFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/featureFlags.server", () => ({ akibaFundedVouchersHubFlag: () => fundedFlag }));

import { listPublicMerchantOffers } from "@/lib/merchants/publicOffers";
import { getAllTemplates, getFundedOffers } from "@/lib/vouchers/catalogue.server";
import { OFFER_LOADERS, merchantStillSaved, processOfferAlerts, type SightedOffer } from "@/lib/push/offerAlerts";

function fakeAdmin(results: Record<string, { data?: unknown; error?: { message: string } | null }> = {}) {
  const calls: Array<{ source: string; offers: SightedOffer[] }> = [];
  const admin = {
    rpc: async (_name: string, args: { p_source: string; p_offers: SightedOffer[] }) => {
      calls.push({ source: args.p_source, offers: args.p_offers });
      return results[args.p_source] ?? { data: { baselined: false, new_offers: 0, queued: 0 }, error: null };
    },
  };
  return { admin: admin as never, calls };
}

const MERCHANT = { id: "m1", name: "Kahawa Corner", slug: "kahawa-corner" };

describe("offer loaders", () => {
  it("keys each offer by source and keeps only the merchant fields", async () => {
    vi.mocked(listPublicMerchantOffers).mockResolvedValue([
      { id: "o1", title: "Brunch deal", partner: { ...MERCHANT, logoUrl: null } } as never,
    ]);
    vi.mocked(getAllTemplates).mockResolvedValue([
      { id: "t1", title: "Free coffee", partners: { ...MERCHANT, image_url: null } } as never,
      { id: "t2", title: "Orphan", partners: null } as never,
    ]);

    expect(await OFFER_LOADERS.merchant_offer()).toEqual([
      { key: "merchant_offer:o1", title: "Brunch deal", merchants: [MERCHANT] },
    ]);
    expect(await OFFER_LOADERS.template()).toEqual([{ key: "template:t1", title: "Free coffee", merchants: [MERCHANT] }]);
  });

  it("reads every source strictly, so a failed read is never taken for an empty list", async () => {
    vi.mocked(listPublicMerchantOffers).mockClear();
    vi.mocked(getAllTemplates).mockClear();
    vi.mocked(listPublicMerchantOffers).mockResolvedValue([]);
    vi.mocked(getAllTemplates).mockResolvedValue([]);
    await OFFER_LOADERS.merchant_offer();
    await OFFER_LOADERS.template();
    expect(listPublicMerchantOffers).toHaveBeenCalledWith(50, { strict: true });
    expect(getAllTemplates).toHaveBeenCalledWith(null, { strict: true });
  });

  it("treats switched-off funded vouchers as unavailable, not as no offers", async () => {
    fundedFlag.enabled = false;
    try {
      await expect(OFFER_LOADERS.funded()).rejects.toThrow(/switched off/);
    } finally {
      fundedFlag.enabled = true;
    }
  });

  it("names every participating merchant of a funded offer, and skips sold-out campaigns", async () => {
    vi.mocked(getFundedOffers).mockResolvedValue([
      { allocationId: "a1", title: "25% off", merchants: [{ ...MERCHANT, imageUrl: null }, { id: "m2", name: "Zuri", slug: "zuri", imageUrl: "x" }] },
      { allocationId: "a2", title: "Gone", quantityRemaining: 0, merchants: [{ ...MERCHANT, imageUrl: null }] },
    ] as never);

    expect(await OFFER_LOADERS.funded()).toEqual([
      { key: "funded:a1", title: "25% off", merchants: [MERCHANT, { id: "m2", name: "Zuri", slug: "zuri" }] },
    ]);
  });
});

describe("processOfferAlerts", () => {
  it("records each source and reports what the database queued", async () => {
    const { admin, calls } = fakeAdmin({ funded: { data: { baselined: false, new_offers: 2, queued: 3 }, error: null } });
    const offer = { key: "funded:a1", title: "25% off", merchants: [MERCHANT] };

    const results = await processOfferAlerts(admin, {
      merchant_offer: async () => [],
      funded: async () => [offer],
      template: async () => [],
    });

    expect(calls.map((c) => c.source)).toEqual(["merchant_offer", "funded", "template"]);
    expect(calls[1].offers).toEqual([offer]);
    expect(results[1]).toEqual({ source: "funded", status: "recorded", baselined: false, quietHours: false, newOffers: 2, queued: 3 });
  });

  it("skips a source whose offers can't be loaded rather than recording it as empty", async () => {
    const { admin, calls } = fakeAdmin();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await processOfferAlerts(admin, {
      merchant_offer: async () => [],
      funded: async () => {
        throw new Error("allocations");
      },
      template: async () => [],
    });

    expect(calls.map((c) => c.source)).toEqual(["merchant_offer", "template"]);
    expect(results.find((r) => r.source === "funded")).toEqual({ source: "funded", status: "unavailable", error: "allocations" });
  });

  it("reports a database failure for that source and carries on", async () => {
    const { admin } = fakeAdmin({ merchant_offer: { data: null, error: { message: "boom" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await processOfferAlerts(admin, {
      merchant_offer: async () => [],
      funded: async () => [],
      template: async () => [],
    });

    expect(results.map((r) => r.status)).toEqual(["failed", "recorded", "recorded"]);
  });
});

describe("merchantStillSaved", () => {
  function savedAdmin(result: { data: unknown; error: unknown }) {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => result };
    return { from: () => query } as never;
  }

  it("is true only while the save exists", async () => {
    expect(await merchantStillSaved(savedAdmin({ data: { id: "s" }, error: null }), "u", "m1")).toBe(true);
    expect(await merchantStillSaved(savedAdmin({ data: null, error: null }), "u", "m1")).toBe(false);
    expect(await merchantStillSaved(savedAdmin({ data: null, error: null }), "u", undefined)).toBe(false);
  });

  it("sends when the lookup fails", async () => {
    expect(await merchantStillSaved(savedAdmin({ data: null, error: { message: "x" } }), "u", "m1")).toBe(true);
  });
});
