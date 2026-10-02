import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const state = vi.hoisted(() => ({ cohort: [] as Array<{ partner_id: string }> }));

const mockRpc = vi.fn((_name: string, _args?: Record<string, unknown>) => Promise.resolve({ data: null, error: null as { message: string } | null }));
const mockFrom = vi.fn((table: string) => {
  if (table === "merchant_discovery_settings") {
    return {
      select: () => ({
        eq: async () => ({ data: state.cohort, error: null }),
      }),
    };
  }
  throw new Error(`Unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

const { POST } = await import("@/app/api/internal/verified-discovery-rebuild/route");

function makeRequest(body: unknown, secret?: string): Request {
  return new Request("http://localhost/api/internal/verified-discovery-rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;

describe("POST /api/internal/verified-discovery-rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    state.cohort = [];
  });

  afterAll(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("rejects requests without the correct secret", async () => {
    const res = await POST(makeRequest({}, "wrong"));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed partnerId", async () => {
    const res = await POST(makeRequest({ partnerId: "not-a-uuid" }, "test-secret"));
    expect(res.status).toBe(400);
  });

  it("rebuilds a single partner immediately when partnerId is given", async () => {
    const partnerId = "e8069a29-d2b0-4ad1-946d-45ad505acd76";
    const res = await POST(makeRequest({ partnerId }, "test-secret"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, rebuilt: [partnerId] });
    expect(mockRpc).toHaveBeenCalledWith("recompute_merchant_discovery_snapshot", { p_partner_id: partnerId });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rebuilds the full pilot cohort when no partnerId is given", async () => {
    state.cohort = [{ partner_id: "m1" }, { partner_id: "m2" }];
    const res = await POST(makeRequest({}, "test-secret"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.rebuilt).toEqual(["m1", "m2"]);
    expect(mockRpc).toHaveBeenCalledWith("recompute_merchant_discovery_snapshot", { p_partner_id: "m1" });
    expect(mockRpc).toHaveBeenCalledWith("recompute_merchant_discovery_snapshot", { p_partner_id: "m2" });
  });

  it("reports partial failure without throwing", async () => {
    state.cohort = [{ partner_id: "m1" }, { partner_id: "m2" }];
    mockRpc.mockImplementation((_name: string, args?: Record<string, unknown>) =>
      Promise.resolve(args?.p_partner_id === "m2" ? { data: null, error: { message: "db error" } } : { data: null, error: null }),
    );
    const res = await POST(makeRequest({}, "test-secret"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.rebuilt).toEqual(["m1"]);
    expect(json.failed).toEqual(["m2"]);
  });
});
