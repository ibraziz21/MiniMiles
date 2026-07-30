import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  feedShouldThrow: false,
  lastFeedArgs: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

const mockGetHomeFeed = vi.fn();
vi.mock("@/lib/home/feed", () => ({
  getHomeFeed: (...args: unknown[]) => mockGetHomeFeed(...args),
}));

const { GET } = await import("@/app/api/home/feed/route");

describe("GET /api/home/feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
    state.feedShouldThrow = false;
    state.lastFeedArgs = null;

    mockGetHomeFeed.mockImplementation(async (args: Record<string, unknown>) => {
      state.lastFeedArgs = args;
      if (state.feedShouldThrow) throw new Error("db exploded");
      return {
        rankingVersion: "home-v2-phase1",
        generatedAt: new Date().toISOString(),
        intents: [],
        sections: [],
        rewards: args.userId ? { milesBalance: 0, activeVoucherCount: 0, hasPass: false } : null,
      };
    });
  });

  it("passes no rewards / no user id for an anonymous request", async () => {
    const res = await GET(new Request("http://localhost/api/home/feed"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rewards).toBeNull();
    expect(state.lastFeedArgs?.userId).toBeNull();
  });

  it("passes the session user id/email for a signed-in request", async () => {
    state.user = { id: "user-1", email: "u@test.com" };

    await GET(new Request("http://localhost/api/home/feed"));

    expect(state.lastFeedArgs?.userId).toBe("user-1");
    expect(state.lastFeedArgs?.userEmail).toBe("u@test.com");
  });

  it("rejects out-of-range coordinates with 400 before calling the feed", async () => {
    const res = await GET(new Request("http://localhost/api/home/feed?lat=999&lng=0"));

    expect(res.status).toBe(400);
    expect(mockGetHomeFeed).not.toHaveBeenCalled();
  });

  it("caps limit_per_section at 10", async () => {
    await GET(new Request("http://localhost/api/home/feed?limit_per_section=999"));
    expect(state.lastFeedArgs?.limitPerSection).toBe(10);
  });

  it("never leaks a raw feed error in the response body", async () => {
    state.feedShouldThrow = true;

    const res = await GET(new Request("http://localhost/api/home/feed"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("exploded");
    expect(body.error).toBe("feed_unavailable");
  });
});
