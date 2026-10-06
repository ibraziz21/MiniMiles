import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  hubProfileRow: null as { city: string | null; country: string | null } | null,
  leaderboardUsername: null as string | null,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "hub_user_profiles") return { data: state.hubProfileRow, error: null };
            if (table === "leaderboard_profiles") {
              return { data: state.leaderboardUsername ? { username: state.leaderboardUsername } : null, error: null };
            }
            throw new Error(`Unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));

const resolveHubProfileMock = vi.fn();
vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: (...args: unknown[]) => resolveHubProfileMock(...args),
}));

const resolveHubQuestCanonicalMock = vi.fn();
vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  resolveHubQuestCanonical: (...args: unknown[]) => resolveHubQuestCanonicalMock(...args),
}));

const getUserBalanceMock = vi.fn();
vi.mock("@/lib/akiba/balance", () => ({
  getUserBalance: (...args: unknown[]) => getUserBalanceMock(...args),
}));

const getRecentActivityMock = vi.fn();
vi.mock("@/lib/akiba/activity", () => ({
  getRecentActivity: (...args: unknown[]) => getRecentActivityMock(...args),
}));

const getLinkedWalletAddressesMock = vi.fn();
const getOwnedVoucherPreviewsMock = vi.fn();
vi.mock("@/lib/akiba/myVouchers", () => ({
  getLinkedWalletAddresses: (...args: unknown[]) => getLinkedWalletAddressesMock(...args),
  getOwnedVoucherPreviews: (...args: unknown[]) => getOwnedVoucherPreviewsMock(...args),
}));

const getProfileStatsMock = vi.fn();
vi.mock("@/lib/akiba/profileStats", () => ({
  getProfileStats: (...args: unknown[]) => getProfileStatsMock(...args),
}));

const listSavedMerchantsMock = vi.fn();
vi.mock("@/lib/merchants/savedMerchants", () => ({
  listSavedMerchants: (...args: unknown[]) => listSavedMerchantsMock(...args),
}));

const getVerifiedDiscoveryHighlightsMock = vi.fn();
vi.mock("@/lib/home/verifiedDiscovery", () => ({
  getVerifiedDiscoveryHighlights: (...args: unknown[]) => getVerifiedDiscoveryHighlightsMock(...args),
}));

const { GET } = await import("@/app/api/v1/me/overview/route");

function req() {
  return new Request("http://localhost/api/v1/me/overview");
}

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    rows: [],
    activeRow: { username: "legacy_name", country: "KE", avatar_url: null },
    walletAddress: "0xabc",
    displayName: "Member Name",
    needsPicker: false,
    ...overrides,
  };
}

describe("GET /api/v1/me/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.hubProfileRow = { city: "Nairobi", country: "Kenya" };
    state.leaderboardUsername = "akiba_handle";

    resolveHubProfileMock.mockImplementation(async () => baseProfile());
    resolveHubQuestCanonicalMock.mockResolvedValue("canonical-1");
    getUserBalanceMock.mockResolvedValue({ chainBalance: 10, ledgerBalance: 20, balance: 30, hasBalance: true });
    getRecentActivityMock.mockResolvedValue([{ id: "a1", ts: 1, kind: "earn", title: "T", detail: null, miles: 5 }]);
    getLinkedWalletAddressesMock.mockResolvedValue(["0xabc"]);
    getOwnedVoucherPreviewsMock.mockResolvedValue({ items: [], totalCount: 0 });
    getProfileStatsMock.mockResolvedValue({ placesVisited: 2, rewardsUsed: 1 });
    listSavedMerchantsMock.mockResolvedValue([]);
    getVerifiedDiscoveryHighlightsMock.mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("composes the full overview DTO from each loader, scoped to the actor", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      profile: {
        displayName: "Member Name",
        username: "akiba_handle",
        avatarUrl: null,
        email: "a@example.com",
        walletAddress: "0xabc",
        city: "Nairobi",
        country: "Kenya",
        needsWalletChoice: false,
      },
      balance: { chainBalance: 10, ledgerBalance: 20, balance: 30, hasBalance: true },
      stats: { placesVisited: 2, rewardsUsed: 1 },
      activity: [{ id: "a1", ts: 1, kind: "earn", title: "T", detail: null, miles: 5 }],
      savedMerchants: [],
      verifiedPlaces: [],
      voucherPreview: { items: [], totalCount: 0 },
    });
    expect(resolveHubProfileMock).toHaveBeenCalledWith({ userId: "u1", email: "a@example.com" });
    expect(getProfileStatsMock).toHaveBeenCalledWith({ userId: "u1", walletAddresses: ["0xabc"] });
  });

  it("falls back from leaderboard username to the legacy activeRow username, then null", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };

    state.leaderboardUsername = null;
    const withFallback = await (await GET(req())).json();
    expect(withFallback.data.profile.username).toBe("legacy_name");

    resolveHubProfileMock.mockImplementation(async () => baseProfile({ activeRow: null }));
    const withNeither = await (await GET(req())).json();
    expect(withNeither.data.profile.username).toBeNull();
  });

  it("falls back country to activeRow.country when hub_user_profiles has none, but never falls back city", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.hubProfileRow = { city: null, country: null };
    const body = await (await GET(req())).json();
    expect(body.data.profile.country).toBe("KE");
    expect(body.data.profile.city).toBeNull();
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
