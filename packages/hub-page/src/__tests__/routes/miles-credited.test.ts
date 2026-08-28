import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

const mockProduce = vi.fn();
vi.mock("@/lib/akiba/milesEarnedNotification", () => ({
  produceMilesEarnedNotification: (...args: unknown[]) => mockProduce(...args),
}));

const { POST } = await import("@/app/api/internal/miles-credited/route");

const VALID_EVENT = {
  eventId: "platform-evt-1",
  hubUserId: "10000000-0000-4000-8000-000000000001",
  merchantId: "20000000-0000-4000-8000-000000000002",
  merchantName: "Merchant X",
  milesAwarded: 120,
  source: "merchant_scan",
  occurredAt: "2026-08-28T00:00:00.000Z",
};

function request(body: unknown, token = "svc-key-1") {
  return new Request("http://localhost/api/internal/miles-credited", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/miles-credited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AKIBA_API_KEY = "svc-key-1";
    delete process.env.AKIBA_API_KEYS;
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockProduce.mockResolvedValue({ ok: true });
  });

  it("rejects a caller with no bearer token", async () => {
    const res = await POST(request(VALID_EVENT, ""));
    expect(res.status).toBe(401);
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("rejects a caller with the wrong service key", async () => {
    const res = await POST(request(VALID_EVENT, "wrong-key"));
    expect(res.status).toBe(401);
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("rejects a caller over the rate limit", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(request(VALID_EVENT));
    expect(res.status).toBe(429);
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const req = new Request("http://localhost/api/internal/miles-credited", {
      method: "POST",
      headers: { Authorization: "Bearer svc-key-1", "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it.each([
    ["missing eventId", { ...VALID_EVENT, eventId: undefined }],
    ["non-UUID hubUserId", { ...VALID_EVENT, hubUserId: "not-a-uuid" }],
    ["non-UUID merchantId", { ...VALID_EVENT, merchantId: "not-a-uuid" }],
    ["blank merchantName", { ...VALID_EVENT, merchantName: "  " }],
    ["zero milesAwarded", { ...VALID_EVENT, milesAwarded: 0 }],
    ["fractional milesAwarded", { ...VALID_EVENT, milesAwarded: 12.5 }],
    ["unknown source", { ...VALID_EVENT, source: "manual_grant" }],
    ["invalid occurredAt", { ...VALID_EVENT, occurredAt: "not-a-date" }],
  ])("rejects an event with %s", async (_label, body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(mockProduce).not.toHaveBeenCalled();
  });

  it("accepts a valid event and forwards it to the shared producer", async () => {
    const res = await POST(request(VALID_EVENT));
    const json = (await res.json()) as { ok: boolean; notified: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.notified).toBe(true);
    expect(mockProduce).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "platform-evt-1",
        hubUserId: VALID_EVENT.hubUserId,
        merchantId: VALID_EVENT.merchantId,
        merchantName: "Merchant X",
        milesAwarded: 120,
        source: "merchant_scan",
      }),
    );
  });

  it("is idempotent — replaying the same eventId is not itself an error", async () => {
    mockProduce.mockResolvedValue({ ok: false, skipped: "notifications_disabled" });
    const res = await POST(request(VALID_EVENT));
    expect(res.status).toBe(200);
  });

  it("returns 500 (retryable) when the outbox write itself fails", async () => {
    mockProduce.mockResolvedValue({ ok: false, skipped: "insert_failed" });
    const res = await POST(request(VALID_EVENT));
    expect(res.status).toBe(500);
  });
});
