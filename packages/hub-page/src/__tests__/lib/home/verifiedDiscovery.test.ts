import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  visits: [] as unknown[],
  visitsError: null as null | { message: string },
  partners: [] as unknown[],
  photos: [] as unknown[],
  contributionItems: [] as unknown[],
  mentions: [] as unknown[],
  canonicalItems: [] as unknown[],
  signedUrls: [] as string[],
}));

function chainable(result: unknown): any {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "partner_settings") return chainable({ data: state.partners, error: null });
      if (table === "merchant_discovery_contribution_items") return chainable({ data: state.contributionItems, error: null });
      if (table === "merchant_discovery_item_mentions") return chainable({ data: state.mentions, error: null });
      if (table === "merchant_discovery_items") return chainable({ data: state.canonicalItems, error: null });
      throw new Error(`Unexpected table ${table}`);
    },
    rpc: (name: string) => {
      if (name === "eligible_public_merchant_visits") {
        return chainable({ data: state.visitsError ? null : state.visits, error: state.visitsError });
      }
      if (name === "eligible_public_merchant_visit_photos") return chainable({ data: state.photos, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: () => ({
        createSignedUrls: async () => ({
          data: state.signedUrls.map((signedUrl) => ({ signedUrl })),
          error: null,
        }),
      }),
    },
  }),
}));

const { getVerifiedDiscoveryHighlights } = await import("@/lib/home/verifiedDiscovery");

function visit(
  contributionId: string,
  partnerId: string,
  dedupKey: string,
  labels: Array<{ id: string; publicLabel: string }>,
) {
  return {
    contribution_id: contributionId,
    partner_id: partnerId,
    dedup_key: dedupKey,
    experience_option_ids: labels.map((label) => label.id),
    template_snapshot: { experience_options: labels },
  };
}

describe("verified discovery highlights", () => {
  beforeEach(() => {
    state.visits = [];
    state.visitsError = null;
    state.partners = [];
    state.photos = [];
    state.contributionItems = [];
    state.mentions = [];
    state.canonicalItems = [];
    state.signedUrls = [];
  });

  it("ranks photo-backed merchants by unique contributors and projects only threshold-safe insight labels", async () => {
    // m1 has five unique contributors (c1-c5, five distinct dedup keys) so
    // its loved label and exact count both clear the five-contributor bar;
    // m2 has only one contributor and stays banded as "new".
    state.visits = [
      visit("c1", "m1", "dedup-m1-1", [{ id: "friendly", publicLabel: "Friendly staff" }]),
      visit("c2", "m1", "dedup-m1-2", [{ id: "friendly", publicLabel: "Friendly staff" }]),
      visit("c3", "m1", "dedup-m1-3", [{ id: "friendly", publicLabel: "Friendly staff" }]),
      visit("c4", "m1", "dedup-m1-4", [{ id: "friendly", publicLabel: "Friendly staff" }]),
      visit("c5", "m1", "dedup-m1-5", [{ id: "friendly", publicLabel: "Friendly staff" }]),
      visit("c6", "m2", "dedup-m2-1", [{ id: "quick", publicLabel: "Great for a quick stop" }]),
    ];
    state.partners = [
      { partner_id: "m1", partners: { slug: "alpha", name: "Alpha Coffee" } },
      { partner_id: "m2", partners: { slug: "beta", name: "Beta Coffee" } },
    ];
    state.photos = [
      { photo_id: "p1", contribution_id: "c1", partner_id: "m1", thumbnail_key: "m1/t.webp", display_key: "m1/d.webp" },
      { photo_id: "p2", contribution_id: "c6", partner_id: "m2", thumbnail_key: "m2/t.webp", display_key: "m2/d.webp" },
    ];
    state.contributionItems = [{ contribution_id: "c1", item_mention_id: "mention-1" }];
    state.mentions = [{ id: "mention-1", canonical_item_id: "item-1" }];
    state.canonicalItems = [{ id: "item-1", canonical_name: "Caffe latte" }];
    state.signedUrls = [
      "https://cdn.example/m1-t.webp", "https://cdn.example/m1-d.webp",
      "https://cdn.example/m2-t.webp", "https://cdn.example/m2-d.webp",
    ];

    const highlights = await getVerifiedDiscoveryHighlights();

    expect(highlights.map((highlight) => [highlight.merchantId, highlight.verifiedRecommendationBand])).toEqual([
      ["m1", { kind: "exact", count: 5 }],
      ["m2", { kind: "new" }],
    ]);
    expect(highlights[0]).toEqual(expect.objectContaining({
      merchantSlug: "alpha",
      lovedLabels: ["Friendly staff"],
    }));
    // Only one unique contributor recommended the latte — below the
    // five-unique-contributor threshold, so it must not appear.
    expect(highlights[0].recommendedItems).toEqual([]);
  });

  it("does not surface a loved label below the five-unique-contributor threshold", async () => {
    state.visits = [
      visit("c1", "m1", "dedup-1", [{ id: "friendly", publicLabel: "Friendly staff" }]),
      visit("c2", "m1", "dedup-2", [{ id: "friendly", publicLabel: "Friendly staff" }]),
    ];
    state.partners = [{ partner_id: "m1", partners: { slug: "alpha", name: "Alpha Coffee" } }];
    state.photos = [
      { photo_id: "p1", contribution_id: "c1", partner_id: "m1", thumbnail_key: "m1/t.webp", display_key: "m1/d.webp" },
    ];
    state.signedUrls = ["https://cdn.example/m1-t.webp", "https://cdn.example/m1-d.webp"];

    const highlights = await getVerifiedDiscoveryHighlights();

    expect(highlights[0].lovedLabels).toEqual([]);
    expect(highlights[0].verifiedRecommendationBand).toEqual({ kind: "new" });
  });

  it("counts same-member same-day activity once toward the contributor band", async () => {
    // Same dedup_key repeated — one member, same merchant, same day — must
    // not inflate the unique-contributor count (hardening spec §4.3).
    state.visits = Array.from({ length: 6 }, (_, i) => visit(`c${i}`, "m1", "dedup-shared", []));
    state.partners = [{ partner_id: "m1", partners: { slug: "alpha", name: "Alpha Coffee" } }];
    state.photos = [
      { photo_id: "p1", contribution_id: "c0", partner_id: "m1", thumbnail_key: "m1/t.webp", display_key: "m1/d.webp" },
    ];
    state.signedUrls = ["https://cdn.example/m1-t.webp", "https://cdn.example/m1-d.webp"];

    const highlights = await getVerifiedDiscoveryHighlights();

    expect(highlights[0].verifiedRecommendationBand).toEqual({ kind: "new" });
  });

  it("does not allocate a spotlight to a merchant without an eligible approved visit photo", async () => {
    state.visits = [visit("c1", "m1", "dedup-1", [])];
    state.partners = [{ partner_id: "m1", partners: { slug: "alpha", name: "Alpha Coffee" } }];

    await expect(getVerifiedDiscoveryHighlights()).resolves.toEqual([]);
  });

  it("fails closed when the eligible-visits projection is unavailable", async () => {
    state.visitsError = { message: "database unavailable" };

    await expect(getVerifiedDiscoveryHighlights()).resolves.toEqual([]);
  });

  it("returns nothing when the spotlight kill switch is off, without even querying the projection", async () => {
    state.visits = [visit("c1", "m1", "dedup-1", [])];
    const original = process.env.HUB_DISCOVERY_SPOTLIGHT_ENABLED;
    process.env.HUB_DISCOVERY_SPOTLIGHT_ENABLED = "false";
    try {
      await expect(getVerifiedDiscoveryHighlights()).resolves.toEqual([]);
    } finally {
      process.env.HUB_DISCOVERY_SPOTLIGHT_ENABLED = original;
    }
  });
});
