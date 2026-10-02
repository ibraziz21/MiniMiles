import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockMaybeSingle = vi.fn();
const mockFrom = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      maybeSingle: mockMaybeSingle,
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

const { POST } = await import("@/app/api/internal/verified-earning-status/route");

function request(body: unknown, token = "svc-key-1") {
  return new Request("http://localhost/api/internal/verified-earning-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  eventId: "platform-evt-1",
  statusChangeEventId: "reversal-evt-1",
  toStatus: "reversed",
  reason: "chargeback",
};

describe("POST /api/internal/verified-earning-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AKIBA_API_KEY = "svc-key-1";
    delete process.env.AKIBA_API_KEYS;
    mockRpc.mockImplementation((name: string) => {
      if (name === "check_rate_limit") return Promise.resolve({ data: true, error: null });
      if (name === "apply_verified_earning_status_change") {
        return Promise.resolve({
          data: [{ ok: true, applied: true, from_status: "active", to_status: "reversed" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mockMaybeSingle.mockResolvedValue({ data: { id: "evt-uuid-1" }, error: null });
  });

  it("rejects a caller with no bearer token", async () => {
    const res = await POST(request(VALID_BODY, ""));
    expect(res.status).toBe(401);
  });

  it("rejects a caller with the wrong service key", async () => {
    const res = await POST(request(VALID_BODY, "wrong-key"));
    expect(res.status).toBe(401);
  });

  it("rejects a caller over the rate limit", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "check_rate_limit") return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it("rejects malformed JSON", async () => {
    const req = new Request("http://localhost/api/internal/verified-earning-status", {
      method: "POST",
      headers: { Authorization: "Bearer svc-key-1", "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it.each([
    ["missing eventId", { ...VALID_BODY, eventId: undefined }],
    ["missing statusChangeEventId", { ...VALID_BODY, statusChangeEventId: undefined }],
    ["unknown toStatus", { ...VALID_BODY, toStatus: "cancelled" }],
    ["oversized reason", { ...VALID_BODY, reason: "x".repeat(501) }],
  ])("rejects a request with %s", async (_label, body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the referenced earning event doesn't exist", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await POST(request(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it("applies a reversal and returns the transition", async () => {
    const res = await POST(request(VALID_BODY));
    const json = (await res.json()) as { ok: boolean; applied: boolean; fromStatus: string; toStatus: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, applied: true, fromStatus: "active", toStatus: "reversed" });
    expect(mockRpc).toHaveBeenCalledWith(
      "apply_verified_earning_status_change",
      expect.objectContaining({
        p_status_change_event_id: "reversal-evt-1",
        p_event_id: "evt-uuid-1",
        p_to_status: "reversed",
        p_reason: "chargeback",
      }),
    );
  });

  it("is idempotent — replaying the same statusChangeEventId reports applied: false", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "check_rate_limit") return Promise.resolve({ data: true, error: null });
      if (name === "apply_verified_earning_status_change") {
        return Promise.resolve({
          data: [{ ok: true, applied: false, from_status: null, to_status: "reversed" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const res = await POST(request(VALID_BODY));
    const json = (await res.json()) as { applied: boolean };
    expect(res.status).toBe(200);
    expect(json.applied).toBe(false);
  });

  it("accepts a reinstatement to active", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "check_rate_limit") return Promise.resolve({ data: true, error: null });
      if (name === "apply_verified_earning_status_change") {
        return Promise.resolve({
          data: [{ ok: true, applied: true, from_status: "disputed", to_status: "active" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const res = await POST(request({ ...VALID_BODY, toStatus: "active", reason: undefined }));
    const json = (await res.json()) as { toStatus: string };
    expect(res.status).toBe(200);
    expect(json.toStatus).toBe("active");
  });
});
