/**
 * Unit tests for the Earn tab's Platform-quest BFF (discovery-quests-
 * spec.md §5): GET /api/quests/platform (list + per-wallet status) and
 * POST /api/quests/platform/claim (ownership check + proxy claim).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_API_KEY = "ak_live_test";

const mockSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireSession: () => mockSession(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  mockSession.mockReset();
  mockSession.mockResolvedValue({ walletAddress: "0xABC", issuedAt: Date.now() });
});

describe("GET /api/quests/platform", () => {
  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/quests/platform/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("composes quest list + completions + reward status into card states", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/quests?")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: [
            { questId: "q-pass", name: "Get your Akiba Pass", description: null, rewardAmount: 100, status: "active", frequency: "one_time" },
            { questId: "q-purchase", name: "First Purchase", description: null, rewardAmount: 100, status: "live", frequency: "one_time" },
            { questId: "q-draft", name: "Not live yet", description: null, rewardAmount: 100, status: "draft", frequency: "one_time" },
          ],
        }));
      }
      if (url.includes("/quests/q-pass/completions")) {
        return Promise.resolve(jsonResponse({ success: true, data: [{ rewardId: "reward-1" }] }));
      }
      if (url.includes("/rewards/reward-1")) {
        return Promise.resolve(jsonResponse({ success: true, data: { status: "active" } }));
      }
      if (url.includes("/quests/q-purchase/completions")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      if (url.includes("/verifications?")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      return Promise.resolve(jsonResponse({ success: false }, 404));
    });

    const { GET } = await import("@/app/api/quests/platform/route");
    const res = await GET();
    const json = await res.json() as { quests: Array<{ questId: string; status: string }> };

    expect(res.status).toBe(200);
    // draft quest excluded entirely
    expect(json.quests.map((q) => q.questId)).toEqual(["q-pass", "q-purchase"]);
    expect(json.quests.find((q) => q.questId === "q-pass")?.status).toBe("claimable");
    expect(json.quests.find((q) => q.questId === "q-purchase")?.status).toBe("locked");
  });

  it("marks a quest claimed when its reward is already claimed", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/quests?")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: [{ questId: "q1", name: "Q1", description: null, rewardAmount: 100, status: "active", frequency: "one_time" }],
        }));
      }
      if (url.includes("/completions")) {
        return Promise.resolve(jsonResponse({ success: true, data: [{ rewardId: "reward-9" }] }));
      }
      if (url.includes("/rewards/reward-9")) {
        return Promise.resolve(jsonResponse({ success: true, data: { status: "claimed" } }));
      }
      return Promise.resolve(jsonResponse({ success: false }, 404));
    });

    const { GET } = await import("@/app/api/quests/platform/route");
    const res = await GET();
    const json = await res.json() as { quests: Array<{ status: string }> };
    expect(json.quests[0]?.status).toBe("claimed");
  });

  it("marks a quest pending when verified but not yet a completion row", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/quests?")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: [{ questId: "q1", name: "Q1", description: null, rewardAmount: 25, status: "live", frequency: "weekly" }],
        }));
      }
      if (url.includes("/completions")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      if (url.includes("/verifications?")) {
        return Promise.resolve(jsonResponse({ success: true, data: [{ id: "v1" }] }));
      }
      return Promise.resolve(jsonResponse({ success: false }, 404));
    });

    const { GET } = await import("@/app/api/quests/platform/route");
    const res = await GET();
    const json = await res.json() as { quests: Array<{ status: string }> };
    expect(json.quests[0]?.status).toBe("pending");
  });

  it("returns a degraded 502 when Platform is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const { GET } = await import("@/app/api/quests/platform/route");
    const res = await GET();
    const json = await res.json() as { degraded: boolean };
    expect(res.status).toBe(502);
    expect(json.degraded).toBe(true);
  });

  it("serves from the 60s cache on a second call without re-fetching", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/quests?")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: [{ questId: "q1", name: "Q1", description: null, rewardAmount: 100, status: "active", frequency: "one_time" }],
        }));
      }
      if (url.includes("/completions")) return Promise.resolve(jsonResponse({ success: true, data: [] }));
      if (url.includes("/verifications?")) return Promise.resolve(jsonResponse({ success: true, data: [] }));
      return Promise.resolve(jsonResponse({ success: false }, 404));
    });

    const { GET } = await import("@/app/api/quests/platform/route");
    await GET();
    const callsAfterFirst = mockFetch.mock.calls.length;
    await GET();
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("POST /api/quests/platform/claim", () => {
  function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/quests/platform/claim", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/quests/platform/claim/route");
    const res = await POST(makeRequest({ rewardId: "r1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when rewardId is missing", async () => {
    const { POST } = await import("@/app/api/quests/platform/claim/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 403 when the reward belongs to a different wallet", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: { walletAddress: "0xOTHER", status: "active" } }));
    const { POST } = await import("@/app/api/quests/platform/claim/route");
    const res = await POST(makeRequest({ rewardId: "r1" }));
    expect(res.status).toBe(403);
  });

  it("claims and invalidates the cache on success", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse({ success: true, data: { status: "claimed" } }));
      return Promise.resolve(jsonResponse({ success: true, data: { walletAddress: "0xabc", status: "active" } }));
    });

    const { POST } = await import("@/app/api/quests/platform/claim/route");
    const res = await POST(makeRequest({ rewardId: "r1" }));
    const json = await res.json() as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
