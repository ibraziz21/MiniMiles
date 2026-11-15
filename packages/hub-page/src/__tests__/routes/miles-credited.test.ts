import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
// What purchase_visit_evidence (Akiba-Platform 172) answers; null makes the
// call fail like a dropped connection.
const db = vi.hoisted(() => ({ evidence: null as unknown, evidenceError: false }));
const evidenceCalls: unknown[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => {
      if (name === "purchase_visit_evidence") {
        evidenceCalls.push(args);
        return Promise.resolve(db.evidenceError
          ? { data: null, error: { message: "connection reset" } }
          : { data: db.evidence, error: null });
      }
      return mockRpc(name, args);
    },
  }),
}));

const mockProduce = vi.fn();
vi.mock("@/lib/akiba/milesEarnedNotification", () => ({
  produceMilesEarnedNotification: (...args: unknown[]) => mockProduce(...args),
}));

const mockRecordDiscovery = vi.fn();
vi.mock("@/lib/akiba/discoveryEarningIngestion", () => ({
  recordVerifiedEarningForDiscovery: (...args: unknown[]) => mockRecordDiscovery(...args),
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
    mockRecordDiscovery.mockResolvedValue(undefined);
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

  describe("discovery-event ingestion channel resolution", () => {
    const PURCHASE_ID = "30000000-0000-4000-8000-000000000003";
    const owned = (channel: string) => ({ found: true, owned: true, ownership: "owned_canonical", channel });
    const withPurchase = { ...VALID_EVENT, source: "merchant_purchase", purchaseEventId: PURCHASE_ID };

    beforeEach(() => {
      db.evidence = owned("in_store");
      db.evidenceError = false;
      evidenceCalls.length = 0;
    });

    it("notifies the owner and opens the visit with the shared evidence channel", async () => {
      const res = await POST(request(withPurchase));
      expect(res.status).toBe(200);
      expect(evidenceCalls).toEqual([{ p_purchase_event_id: PURCHASE_ID, p_hub_user_id: VALID_EVENT.hubUserId, p_merchant_id: VALID_EVENT.merchantId }]);
      expect(mockProduce).toHaveBeenCalledTimes(1);
      expect(mockRecordDiscovery).toHaveBeenLastCalledWith(expect.anything(), "in_store");
    });

    it("ignores the event's own source and channel — only the purchase decides", async () => {
      db.evidence = owned("unknown");
      await POST(request({ ...withPurchase, source: "merchant_scan", channel: "in_store" }));
      expect(mockRecordDiscovery).toHaveBeenLastCalledWith(expect.anything(), "unknown");
    });

    it.each([
      ["recipient_mismatch", "a different member"],
      ["merchant_mismatch", "a different merchant"],
      ["purchase_not_found", "a missing purchase row"],
      ["member_identity_unavailable", "a member with no identity mapping"],
    ])("sends nothing for %s (%s), and doesn't ask to be retried", async (ownership) => {
      db.evidence = { found: ownership !== "purchase_not_found", owned: false, ownership, channel: "unknown" };
      const res = await POST(request(withPurchase));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ notified: false, skipped: ownership });
      expect(mockProduce).not.toHaveBeenCalled();
      expect(mockRecordDiscovery).not.toHaveBeenCalled();
    });

    it("answers a transient lookup failure with 500 and sends nothing, then succeeds on retry", async () => {
      db.evidenceError = true;
      const failed = await POST(request(withPurchase));
      expect(failed.status).toBe(500);
      expect(mockProduce).not.toHaveBeenCalled();
      expect(mockRecordDiscovery).not.toHaveBeenCalled();

      db.evidenceError = false;
      const retried = await POST(request(withPurchase));
      expect(retried.status).toBe(200);
      expect(mockProduce).toHaveBeenCalledTimes(1);
      expect(mockRecordDiscovery).toHaveBeenLastCalledWith(expect.anything(), "in_store");
    });

    it("rejects a malformed purchase id outright", async () => {
      const res = await POST(request({ ...withPurchase, purchaseEventId: "not-a-uuid" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_purchase_event_id" });
      expect(evidenceCalls).toEqual([]);
      expect(mockProduce).not.toHaveBeenCalled();
    });

    it("still notifies a legacy event with no purchase id, but never opens a visit for it", async () => {
      const res = await POST(request({ ...VALID_EVENT, channel: "in_store" }));
      expect(res.status).toBe(200);
      expect(evidenceCalls).toEqual([]);
      expect(mockProduce).toHaveBeenCalledTimes(1);
      expect(mockRecordDiscovery).not.toHaveBeenCalled();
    });

    it("rejects an unrecognized channel value", async () => {
      const res = await POST(request({ ...VALID_EVENT, channel: "teleport" }));
      expect(res.status).toBe(400);
      expect(mockRecordDiscovery).not.toHaveBeenCalled();
    });

    it("never lets a discovery-ingestion failure affect the response", async () => {
      mockRecordDiscovery.mockRejectedValue(new Error("boom"));
      const res = await POST(request(withPurchase));
      expect(res.status).toBe(200);
    });
  });
});
