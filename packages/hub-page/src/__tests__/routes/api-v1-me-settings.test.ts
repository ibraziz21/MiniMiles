import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  hubProfileRow: null as { city: string | null; country: string | null; phone: string | null } | null,
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

const listLinkedWalletsMock = vi.fn();
vi.mock("@/lib/akiba/wallets", () => ({
  listLinkedWallets: (...args: unknown[]) => listLinkedWalletsMock(...args),
}));

const { GET } = await import("@/app/api/v1/me/settings/route");

function req() {
  return new Request("http://localhost/api/v1/me/settings");
}

describe("GET /api/v1/me/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.hubProfileRow = { city: "Nairobi", country: "Kenya", phone: "+254700000000" };
    state.leaderboardUsername = "akiba_handle";

    resolveHubProfileMock.mockResolvedValue({
      rows: [],
      activeRow: { username: "legacy_name", country: "KE", avatar_url: null },
      walletAddress: "0xabc",
      displayName: "Member Name",
      needsPicker: false,
    });
    resolveHubQuestCanonicalMock.mockResolvedValue("canonical-1");
    listLinkedWalletsMock.mockResolvedValue([
      { ecosystem: "minipay", address: "0xabc", isPrimary: true, linkedAt: "2026-01-01T00:00:00Z", verificationStatus: "verified" },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("composes profile and wallets from each loader, scoped to the actor", async () => {
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
        country: "Kenya",
        city: "Nairobi",
        phone: "+254700000000",
      },
      wallets: [
        { ecosystem: "minipay", address: "0xabc", isPrimary: true, linkedAt: "2026-01-01T00:00:00Z", verificationStatus: "verified" },
      ],
    });
    expect(resolveHubProfileMock).toHaveBeenCalledWith({ userId: "u1", email: "a@example.com" });
    expect(listLinkedWalletsMock).toHaveBeenCalledWith("u1");
  });

  it("passes the wallets array through unchanged — never adds challenge/nonce fields", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const body = await (await GET(req())).json();
    for (const wallet of body.data.wallets) {
      expect(wallet).not.toHaveProperty("nonce");
      expect(wallet).not.toHaveProperty("nonce_hash");
      expect(wallet).not.toHaveProperty("statement_hash");
      expect(Object.keys(wallet).sort()).toEqual(
        ["address", "ecosystem", "isPrimary", "linkedAt", "verificationStatus"].sort(),
      );
    }
  });

  it("falls back country to activeRow.country, but city/phone have no fallback", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.hubProfileRow = { city: null, country: null, phone: null };
    const body = await (await GET(req())).json();
    expect(body.data.profile.country).toBe("KE");
    expect(body.data.profile.city).toBeNull();
    expect(body.data.profile.phone).toBeNull();
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
