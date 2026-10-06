import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" };

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  usernameByCanonical: new Map<string, string | null>(),
  onboardingSeenByUser: new Map<string, string | null>(),
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

vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: async ({ userId }: { userId: string; email: string | null }) => ({
    rows: [],
    activeRow: null,
    walletAddress: null,
    displayName: `${userId}-display-name`,
    needsPicker: userId === "needs-picker-user",
  }),
}));

vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  resolveHubQuestCanonical: async ({ hubUserId }: { hubUserId: string; email: string | null }) =>
    `canonical-${hubUserId}`,
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

function setupAdmin() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "leaderboard_profiles") {
      return {
        select: () => ({
          eq: (_col: string, canonicalId: string) => ({
            maybeSingle: async () => ({
              data: state.usernameByCanonical.has(canonicalId)
                ? { username: state.usernameByCanonical.get(canonicalId) }
                : null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "hub_user_passes") {
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            maybeSingle: async () => ({
              data: state.onboardingSeenByUser.has(userId)
                ? { onboarding_seen_at: state.onboardingSeenByUser.get(userId) }
                : null,
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

const { GET } = await import("@/app/api/v1/me/bootstrap/route");

function bootstrapReq() {
  return new Request("http://localhost/api/v1/me/bootstrap");
}

describe("GET /api/v1/me/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.usernameByCanonical.clear();
    state.onboardingSeenByUser.clear();
    setupAdmin();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(bootstrapReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the member's own DTO when authenticated", async () => {
    state.actor = { userId: "user-a", email: "a@example.com", authMode: "cookie" };
    state.usernameByCanonical.set("canonical-user-a", "akiba_a");
    state.onboardingSeenByUser.set("user-a", "2026-01-01T00:00:00Z");

    const res = await GET(bootstrapReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      user: { id: "user-a", email: "a@example.com", displayName: "user-a-display-name", username: "akiba_a" },
      onboarding: { complete: true, needsWalletChoice: false },
      capabilities: { quests: false, nativePush: false },
    });
  });

  it("resolves an identical DTO for the same member via cookie and bearer auth", async () => {
    state.usernameByCanonical.set("canonical-user-b", "akiba_b");
    state.onboardingSeenByUser.set("user-b", null);

    state.actor = { userId: "user-b", email: "b@example.com", authMode: "cookie" };
    const cookieBody = await (await GET(bootstrapReq())).json();

    state.actor = { userId: "user-b", email: "b@example.com", authMode: "bearer" };
    const bearerBody = await (await GET(bootstrapReq())).json();

    expect(bearerBody.data).toEqual(cookieBody.data);
  });

  it("never mixes one user's username/onboarding state into another user's response", async () => {
    state.usernameByCanonical.set("canonical-user-a", "akiba_a");
    state.onboardingSeenByUser.set("user-a", "2026-01-01T00:00:00Z");
    state.usernameByCanonical.set("canonical-user-c", null);
    state.onboardingSeenByUser.set("user-c", null);

    state.actor = { userId: "user-a", email: "a@example.com", authMode: "cookie" };
    const userA = await (await GET(bootstrapReq())).json();

    state.actor = { userId: "user-c", email: "c@example.com", authMode: "cookie" };
    const userC = await (await GET(bootstrapReq())).json();

    expect(userA.data.user.username).toBe("akiba_a");
    expect(userA.data.onboarding.complete).toBe(true);
    expect(userC.data.user.username).toBeNull();
    expect(userC.data.onboarding.complete).toBe(false);
  });
});
