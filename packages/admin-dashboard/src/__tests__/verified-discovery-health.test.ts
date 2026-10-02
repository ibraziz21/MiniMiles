import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  photoJobs: [] as unknown[],
  pendingModeration: [] as unknown[],
  projectionJobs: [] as unknown[],
  snapshots: [] as unknown[],
  moderatedPhotoIds: [] as unknown[],
  auditedPhotoIds: [] as unknown[],
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

const mockFrom = vi.fn((table: string) => {
  if (table === "photo_processing_jobs") return chainable({ data: state.photoJobs, error: null });
  if (table === "merchant_discovery_projection_jobs") return chainable({ data: state.projectionJobs, error: null });
  if (table === "merchant_discovery_public_snapshots") return chainable({ data: state.snapshots, error: null });
  if (table === "discovery_moderation_audit_events") return chainable({ data: state.auditedPhotoIds, error: null });
  if (table === "merchant_visit_photos") {
    const callIndex = mockFrom.mock.calls.filter((c) => c[0] === "merchant_visit_photos").length;
    return chainable({ data: callIndex <= 1 ? state.pendingModeration : state.moderatedPhotoIds, error: null });
  }
  throw new Error(`Unexpected table ${table}`);
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: mockFrom } }));

const { getVerifiedDiscoveryHealth } = await import("@/lib/verifiedDiscoveryHealth");

describe("getVerifiedDiscoveryHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.photoJobs = [];
    state.pendingModeration = [];
    state.projectionJobs = [];
    state.snapshots = [];
    state.moderatedPhotoIds = [];
    state.auditedPhotoIds = [];
  });

  it("reports healthy with empty queues", async () => {
    const health = await getVerifiedDiscoveryHealth();
    expect(health.healthy).toBe(true);
    expect(health.warnings).toEqual([]);
    expect(health.error).toBeNull();
  });

  it("flags a moderated photo missing its domain audit event", async () => {
    state.moderatedPhotoIds = [{ id: "photo-1" }];
    state.auditedPhotoIds = [];
    const health = await getVerifiedDiscoveryHealth();
    expect(health.healthy).toBe(false);
    expect(health.moderationQueue.missingAuditCount).toBe(1);
  });

  it("surfaces a sanitized error without throwing when a query fails", async () => {
    mockFrom.mockImplementationOnce(() => chainable({ data: null, error: { message: "db unavailable" } }));
    const health = await getVerifiedDiscoveryHealth();
    expect(health.error).toBe("Verified-discovery health data is unavailable");
    expect(health.healthy).toBe(false);
  });
});
