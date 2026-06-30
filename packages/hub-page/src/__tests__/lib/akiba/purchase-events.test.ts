/**
 * Unit tests for getPurchaseEventForOrder (Platform reward lookup adapter).
 * These tests mock global fetch and verify the adapter's safe-fallback contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set env vars before importing the module
process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_API_KEY = "test-key";

const { getPurchaseEventForOrder } = await import("@/lib/akiba/purchase-events");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPurchaseEventForOrder", () => {
  it("returns rewarded state when Platform reports rewardIssued=true", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ rewardIssued: true, milesAwarded: 300, reason: "launch reward" })
    );

    const result = await getPurchaseEventForOrder("order-abc");

    expect(result.state).toBe("rewarded");
    if (result.state === "rewarded") {
      expect(result.miles).toBe(300);
      expect(result.reason).toBe("launch reward");
    }
  });

  it("returns rewarded when event is nested under purchaseEvent key", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ purchaseEvent: { rewardIssued: true, milesAwarded: 150 } })
    );

    const result = await getPurchaseEventForOrder("order-xyz");

    expect(result.state).toBe("rewarded");
    if (result.state === "rewarded") {
      expect(result.miles).toBe(150);
    }
  });

  it("returns rewarded from Platform list response rows", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        success: true,
        data: [{ status: "rewarded", miles_awarded: 225 }],
        pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
      })
    );

    const result = await getPurchaseEventForOrder("order-list-rewarded");

    expect(result.state).toBe("rewarded");
    if (result.state === "rewarded") {
      expect(result.miles).toBe(225);
    }
  });

  it("returns not_rewarded when Platform reports rewardIssued=false", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ rewardIssued: false, reason: "no active campaign" })
    );

    const result = await getPurchaseEventForOrder("order-def");

    expect(result.state).toBe("not_rewarded");
  });

  it("returns not_rewarded from a no_campaign Platform list response row", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        success: true,
        data: [{ status: "no_campaign", miles_awarded: 0 }],
        pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
      })
    );

    const result = await getPurchaseEventForOrder("order-list-no-campaign");

    expect(result.state).toBe("not_rewarded");
  });

  it("returns pending when Platform list response has no matching event", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        success: true,
        data: [],
        pagination: { total: 0, limit: 25, offset: 0, hasMore: false },
      })
    );

    const result = await getPurchaseEventForOrder("order-list-empty");

    expect(result.state).toBe("pending");
  });

  it("returns pending when Platform returns 404 (event not yet created)", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const result = await getPurchaseEventForOrder("order-ghi");

    expect(result.state).toBe("pending");
  });

  it("returns pending when Platform returns a non-2xx error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Internal error", { status: 500 }));

    const result = await getPurchaseEventForOrder("order-jkl");

    expect(result.state).toBe("pending");
  });

  it("returns pending when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await getPurchaseEventForOrder("order-mno");

    expect(result.state).toBe("pending");
  });

  it("calls Platform with the correct idempotency key in the query string", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ rewardIssued: false }));

    await getPurchaseEventForOrder("order-pqr");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("idempotencyKey=hub-purchase-order-pqr");
  });

  it("sends the Authorization header", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ rewardIssued: false }));

    await getPurchaseEventForOrder("order-stu");

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });
});
