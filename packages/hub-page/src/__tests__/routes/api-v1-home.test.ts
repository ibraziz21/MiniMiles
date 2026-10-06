import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  feed: { rankingVersion: "v1", generatedAt: "2026-01-01T00:00:00Z", intents: [], sections: [], verifiedHighlights: [], rewards: null, nextReward: null } as Record<string, unknown>,
  feedShouldThrow: false,
  cities: ["Nairobi"] as string[],
  displayName: "Member Name",
  nextContribution: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth/requestActor", () => ({
  optionalActor: async () => state.actor,
}));

const getHomeFeedMock = vi.fn();
vi.mock("@/lib/home/feed", () => ({
  getHomeFeed: (...args: unknown[]) => getHomeFeedMock(...args),
}));

const listDirectoryCitiesMock = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  listDirectoryCities: (...args: unknown[]) => listDirectoryCitiesMock(...args),
}));

const resolveHubProfileMock = vi.fn();
vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: (...args: unknown[]) => resolveHubProfileMock(...args),
}));

const getNextDiscoveryContributionRequestMock = vi.fn();
vi.mock("@/lib/akiba/discoveryContributions", () => ({
  getNextDiscoveryContributionRequest: (...args: unknown[]) => getNextDiscoveryContributionRequestMock(...args),
}));

const { GET } = await import("@/app/api/v1/home/route");

function homeReq(query = "") {
  return new Request(`http://localhost/api/v1/home${query}`);
}

describe("GET /api/v1/home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.feedShouldThrow = false;

    getHomeFeedMock.mockImplementation(async () => {
      if (state.feedShouldThrow) throw new Error("boom");
      return state.feed;
    });
    listDirectoryCitiesMock.mockImplementation(async () => state.cities);
    resolveHubProfileMock.mockImplementation(async () => ({
      rows: [],
      activeRow: null,
      walletAddress: null,
      displayName: state.displayName,
      needsPicker: false,
    }));
    getNextDiscoveryContributionRequestMock.mockImplementation(async () => state.nextContribution);
  });

  it("returns member: null for an anonymous caller, and never calls member-only loaders", async () => {
    const res = await GET(homeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.member).toBeNull();
    expect(body.data.feed).toEqual(state.feed);
    expect(body.data.cities).toEqual(state.cities);
    expect(getHomeFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, userEmail: null }),
    );
    expect(resolveHubProfileMock).not.toHaveBeenCalled();
    expect(getNextDiscoveryContributionRequestMock).not.toHaveBeenCalled();
  });

  it("populates member.displayName and member.nextDiscoveryContribution for an authenticated caller", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer" };
    state.nextContribution = { id: "req-1", merchantId: "m1", merchantName: "Acme", templateSnapshot: {}, expiresAt: "2026-02-01T00:00:00Z" };

    const res = await GET(homeReq());
    const body = await res.json();
    expect(body.data.member).toEqual({
      displayName: state.displayName,
      nextDiscoveryContribution: state.nextContribution,
    });
    expect(getHomeFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", userEmail: "a@example.com" }),
    );
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const res = await GET(homeReq("?lat=999&lng=0"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_COORDINATES");
  });

  it("rejects lat provided without lng with 400", async () => {
    const res = await GET(homeReq("?lat=1.2"));
    expect(res.status).toBe(400);
  });

  it("returns a 503 in the v1 error envelope when getHomeFeed fails", async () => {
    state.feedShouldThrow = true;
    const res = await GET(homeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("HOME_FEED_UNAVAILABLE");
    expect(body.error.retryable).toBe(true);
  });

  it("is always private, no-store — anonymous and authenticated alike", async () => {
    const anonRes = await GET(homeReq());
    expect(anonRes.headers.get("cache-control")).toBe("private, no-store");

    state.actor = { userId: "user-1", email: "a@example.com", authMode: "cookie" };
    const authRes = await GET(homeReq());
    expect(authRes.headers.get("cache-control")).toBe("private, no-store");
  });
});
