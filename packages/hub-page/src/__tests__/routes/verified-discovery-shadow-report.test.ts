import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { VerifiedDiscoveryPartnerAggregate } from "@/lib/home/verifiedDiscovery";

const state = vi.hoisted(() => ({
  snapshots: [] as unknown[],
  v1Aggregates: new Map<string, unknown>(),
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

const mockRpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
const mockFrom = vi.fn((table: string) => {
  if (table === "merchant_discovery_public_snapshots") {
    return chainable({ data: state.snapshots, error: null });
  }
  throw new Error(`Unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

vi.mock("@/lib/home/verifiedDiscovery", () => ({
  getVerifiedDiscoveryPartnerAggregates: async () => state.v1Aggregates,
}));

const { GET } = await import("@/app/api/internal/verified-discovery-shadow-report/route");

function makeRequest(secret?: string): Request {
  return new Request("http://localhost/api/internal/verified-discovery-shadow-report", {
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

function aggregate(overrides: Partial<VerifiedDiscoveryPartnerAggregate> = {}): VerifiedDiscoveryPartnerAggregate {
  return {
    partnerId: "m1",
    uniqueContributorCount: 5,
    band: { kind: "exact", count: 5 },
    lovedLabels: ["Friendly staff"],
    recommendedItems: ["Latte"],
    coverPhotoId: "photo-1",
    coverPhotoThumbnailKey: "t.webp",
    coverPhotoDisplayKey: "d.webp",
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    partner_id: "m1",
    active_positive_unique_count: 5,
    public_count_band: "5",
    qualified_experience_labels: ["Friendly staff"],
    qualified_recommended_items: ["Latte"],
    cover_photo_id: "photo-1",
    generated_at: new Date().toISOString(),
    suppression_reason: null,
    ...overrides,
  };
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;

describe("GET /api/internal/verified-discovery-shadow-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    state.snapshots = [];
    state.v1Aggregates = new Map();
  });

  afterAll(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("rejects requests without the correct secret", async () => {
    const res = await GET(makeRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports healthy with no mismatches when V1 and V2 agree", async () => {
    state.snapshots = [{ partner_id: "m1" }];
    state.v1Aggregates = new Map([["m1", aggregate()]]);
    mockFrom.mockImplementation((table: string) => {
      if (table === "merchant_discovery_public_snapshots") {
        // First call (partner id lookup) returns [{partner_id}], second
        // (full row lookup) returns the full snapshot.
        const callCount = mockFrom.mock.calls.filter((c) => c[0] === "merchant_discovery_public_snapshots").length;
        return chainable({ data: callCount <= 1 ? [{ partner_id: "m1" }] : [snapshot()], error: null });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.healthy).toBe(true);
    expect(json.mismatches).toEqual([]);
    expect(json.partnersCompared).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith("recompute_merchant_discovery_snapshot", { p_partner_id: "m1" });
  });

  it("flags an unsafe mismatch when V2 bands exact but V1 says 'new'", async () => {
    state.v1Aggregates = new Map([["m1", aggregate({ uniqueContributorCount: 2, band: { kind: "new" } })]]);
    mockFrom.mockImplementation((table: string) => {
      const callCount = mockFrom.mock.calls.filter((c) => c[0] === table).length;
      return chainable({ data: callCount <= 1 ? [{ partner_id: "m1" }] : [snapshot({ public_count_band: "5" })], error: null });
    });

    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.healthy).toBe(false);
    expect(json.unsafeMismatchCount).toBeGreaterThanOrEqual(1);
    expect(json.mismatches).toContainEqual(expect.objectContaining({ field: "band", direction: "v2_shows_more" }));
  });

  it("flags v2_shows_more when V2 is eligible but V1 found nothing for that partner", async () => {
    state.v1Aggregates = new Map(); // nothing from V1
    mockFrom.mockImplementation((table: string) => {
      const callCount = mockFrom.mock.calls.filter((c) => c[0] === table).length;
      return chainable({ data: callCount <= 1 ? [{ partner_id: "m1" }] : [snapshot()], error: null });
    });

    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.healthy).toBe(false);
    expect(json.mismatches).toContainEqual(expect.objectContaining({ partnerId: "m1", direction: "v2_shows_more" }));
  });

  it("treats a suppressed V2 row with no V1 aggregate as agreement, not a mismatch", async () => {
    state.v1Aggregates = new Map();
    mockFrom.mockImplementation((table: string) => {
      const callCount = mockFrom.mock.calls.filter((c) => c[0] === table).length;
      return chainable({
        data: callCount <= 1 ? [{ partner_id: "m1" }] : [snapshot({ suppression_reason: "no_eligible_photo", cover_photo_id: null })],
        error: null,
      });
    });

    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.healthy).toBe(true);
    expect(json.mismatches).toEqual([]);
  });
});
