import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

function chainable(result: unknown): any {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

const state = vi.hoisted(() => ({ visits: [] as unknown[], photos: [] as unknown[] }));

const mockRpc = vi.fn((name: string) => {
  if (name === "eligible_public_merchant_visits") return chainable({ data: state.visits, error: null });
  if (name === "eligible_public_merchant_visit_photos") return chainable({ data: state.photos, error: null });
  throw new Error(`Unexpected RPC ${name}`);
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

const { GET } = await import("@/app/api/internal/verified-discovery-eligibility/route");

const CONTRIBUTION_ID = "e8069a29-d2b0-4ad1-946d-45ad505acd76";
const PHOTO_ID = "0f4a1d56-d34e-4f11-8abc-33221100aabb";

function makeRequest(query: string, secret?: string): Request {
  return new Request(`http://localhost/api/internal/verified-discovery-eligibility${query}`, {
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;

describe("GET /api/internal/verified-discovery-eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    state.visits = [];
    state.photos = [];
  });

  afterAll(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("rejects requests without the correct secret", async () => {
    const res = await GET(makeRequest(`?contributionId=${CONTRIBUTION_ID}`, "wrong"));
    expect(res.status).toBe(401);
  });

  it("requires at least one id", async () => {
    const res = await GET(makeRequest("", "test-secret"));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed id", async () => {
    const res = await GET(makeRequest("?contributionId=not-a-uuid", "test-secret"));
    expect(res.status).toBe(400);
  });

  it("reports a visit as ineligible when the canonical projection returns nothing", async () => {
    const res = await GET(makeRequest(`?contributionId=${CONTRIBUTION_ID}`, "test-secret"));
    const json = await res.json();
    expect(json).toEqual({ contributionId: CONTRIBUTION_ID, visitPublic: false });
  });

  it("reports both a visit and a photo as eligible when both projections return a row", async () => {
    state.visits = [{ contribution_id: CONTRIBUTION_ID }];
    state.photos = [{ photo_id: PHOTO_ID }];
    const res = await GET(makeRequest(`?contributionId=${CONTRIBUTION_ID}&photoId=${PHOTO_ID}`, "test-secret"));
    const json = await res.json();
    expect(json).toEqual({
      contributionId: CONTRIBUTION_ID, visitPublic: true,
      photoId: PHOTO_ID, photoPublic: true,
    });
  });
});
