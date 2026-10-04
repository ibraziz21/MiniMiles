import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

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
    // First call (pending moderation queue) vs second call (approved/rejected
    // for audit-integrity check) are distinguished by call order per test.
    const callIndex = mockFrom.mock.calls.filter((c) => c[0] === "merchant_visit_photos").length;
    return chainable({ data: callIndex <= 1 ? state.pendingModeration : state.moderatedPhotoIds, error: null });
  }
  throw new Error(`Unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const { GET } = await import("@/app/api/internal/verified-discovery-health/route");

function makeRequest(secret?: string): Request {
  return new Request("http://localhost/api/internal/verified-discovery-health", {
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;

describe("GET /api/internal/verified-discovery-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    state.photoJobs = [];
    state.pendingModeration = [];
    state.projectionJobs = [];
    state.snapshots = [];
    state.moderatedPhotoIds = [];
    state.auditedPhotoIds = [];
  });

  afterAll(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("rejects requests without the correct secret", async () => {
    const res = await GET(makeRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports healthy with empty queues and no flags disabled", async () => {
    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.healthy).toBe(true);
    expect(json.warnings).toEqual([]);
    expect(json.publicProofFlags).toEqual({
      spotlightEnabled: true,
      verifiedVisitsPublicEnabled: true,
      customerPhotosPublicEnabled: true,
      snapshotReadEnabled: false,
    });
  });

  it("flags a photo job stuck in processing beyond the lease window", async () => {
    state.photoJobs = [
      { status: "processing", attempts: 1, created_at: new Date(Date.now() - 20 * 60_000).toISOString(), updated_at: new Date(Date.now() - 15 * 60_000).toISOString() },
    ];
    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.healthy).toBe(false);
    expect(json.photoProcessingQueue.stuck).toBe(1);
    expect(json.warnings.some((w: string) => w.includes("photo processing job"))).toBe(true);
  });

  it("flags a moderated photo with no domain audit event", async () => {
    state.moderatedPhotoIds = [{ id: "photo-1" }];
    state.auditedPhotoIds = []; // no audit row for photo-1

    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.healthy).toBe(false);
    expect(json.moderationQueue.missingAuditCount).toBe(1);
    expect(json.warnings.some((w: string) => w.includes("no domain audit event"))).toBe(true);
  });

  it("does not flag a moderated photo that has its audit event", async () => {
    state.moderatedPhotoIds = [{ id: "photo-1" }];
    state.auditedPhotoIds = [{ photo_id: "photo-1" }];

    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.moderationQueue.missingAuditCount).toBe(0);
  });

  it("warns when the oldest pending projection job exceeds the lag budget", async () => {
    state.projectionJobs = [
      { partner_id: "m1", status: "pending", attempts: 0, created_at: new Date(Date.now() - 20 * 60_000).toISOString(), updated_at: new Date().toISOString() },
    ];
    const res = await GET(makeRequest("test-secret"));
    const json = await res.json();
    expect(json.healthy).toBe(false);
    expect(json.warnings.some((w: string) => w.includes("projection job"))).toBe(true);
  });

  it("reports a disabled public-proof flag in the health payload", async () => {
    const original = process.env.HUB_DISCOVERY_SPOTLIGHT_ENABLED;
    process.env.HUB_DISCOVERY_SPOTLIGHT_ENABLED = "false";
    try {
      const res = await GET(makeRequest("test-secret"));
      const json = await res.json();
      expect(json.publicProofFlags.spotlightEnabled).toBe(false);
    } finally {
      process.env.HUB_DISCOVERY_SPOTLIGHT_ENABLED = original;
    }
  });
});
