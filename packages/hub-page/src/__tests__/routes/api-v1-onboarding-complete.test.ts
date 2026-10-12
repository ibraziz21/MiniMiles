import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  /** user_id -> onboarding_seen_at. A missing key means "no pass row at all". */
  passes: new Map<string, string | null>(),
  selectError: null as { message: string } | null,
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
  resolveHubProfile: async () => ({
    rows: [],
    activeRow: null,
    walletAddress: null,
    displayName: "Member",
    needsPicker: false,
  }),
}));

const getOrCreatePassMock = vi.fn();
vi.mock("@/lib/akiba/pass", () => ({
  getOrCreatePass: (...args: unknown[]) => getOrCreatePassMock(...args),
}));

const updateSpy = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

// Stands in for PostgREST on hub_user_passes: a plain read, and the
// conditional `update ... where onboarding_seen_at is null` the route relies
// on for first-write-wins. The real route's business logic
// (markOnboardingComplete) is NOT mocked — it runs against this fake table.
function setupAdmin() {
  mockFrom.mockImplementation((table: string) => {
    if (table !== "hub_user_passes") throw new Error(`Unexpected table ${table}`);
    return {
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => {
            if (state.selectError) return { data: null, error: state.selectError };
            return {
              data: state.passes.has(userId)
                ? { onboarding_seen_at: state.passes.get(userId) }
                : null,
              error: null,
            };
          },
        }),
      }),
      update: (patch: { onboarding_seen_at: string }) => {
        updateSpy(patch);
        return {
          eq: (_column: string, userId: string) => ({
            is: (_nullColumn: string, _value: null) => ({
              select: () => ({
                maybeSingle: async () => {
                  const current = state.passes.get(userId);
                  // No row, or already completed — nothing is claimed.
                  if (current === undefined || current !== null) {
                    return { data: null, error: null };
                  }
                  state.passes.set(userId, patch.onboarding_seen_at);
                  return { data: { onboarding_seen_at: patch.onboarding_seen_at }, error: null };
                },
              }),
            }),
          }),
        };
      },
    };
  });
}

const { POST } = await import("@/app/api/v1/me/onboarding/complete/route");

function bearerReq(contentType = "application/json") {
  return new Request("http://localhost/api/v1/me/onboarding/complete", {
    method: "POST",
    headers: { "content-type": contentType },
  });
}

function cookieReq(origin: string) {
  return new Request("http://localhost/api/v1/me/onboarding/complete", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
  });
}

describe("POST /api/v1/me/onboarding/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.passes.clear();
    state.selectError = null;
    setupAdmin();
    getOrCreatePassMock.mockImplementation(async ({ userId }: { userId: string }) => {
      state.passes.set(userId, null);
      return { publicPassId: `pass-${userId}`, isNew: true, referralOutcome: "none" };
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(bearerReq());
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects a bearer mutation without a JSON content type", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await POST(bearerReq("text/plain"));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("rejects a cookie-authenticated cross-origin mutation", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "cookie" };
    const res = await POST(cookieReq("https://evil.example"));
    expect(res.status).toBe(403);
  });

  it("records completion for a member whose pass has never completed onboarding", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.passes.set("u1", null);

    const res = await POST(bearerReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.complete).toBe(true);
    expect(Date.parse(body.data.completedAt)).not.toBeNaN();
    expect(state.passes.get("u1")).toBe(body.data.completedAt);
    expect(getOrCreatePassMock).not.toHaveBeenCalled();
  });

  it("is idempotent — a repeat call returns the original timestamp and writes nothing", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.passes.set("u1", null);

    const first = await (await POST(bearerReq())).json();
    updateSpy.mockClear();

    const second = await (await POST(bearerReq())).json();
    expect(second.data.completedAt).toBe(first.data.completedAt);
    expect(second.data.complete).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("treats a member who completed onboarding on web as already complete", async () => {
    state.actor = { userId: "web-user", email: "w@example.com", authMode: "bearer" };
    state.passes.set("web-user", "2026-01-01T00:00:00.000Z");

    const body = await (await POST(bearerReq())).json();
    expect(body.data.completedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("provisions the pass row first when the member has none yet", async () => {
    state.actor = { userId: "fresh", email: "f@example.com", authMode: "bearer" };

    const res = await POST(bearerReq());
    expect(res.status).toBe(200);
    expect(getOrCreatePassMock).toHaveBeenCalledWith({
      userId: "fresh",
      email: "f@example.com",
      walletAddress: null,
    });
    const body = await res.json();
    expect(state.passes.get("fresh")).toBe(body.data.completedAt);
  });

  it("returns a retryable 503 — never a raw database error — when the write cannot land", async () => {
    state.actor = { userId: "ghost", email: "g@example.com", authMode: "bearer" };
    getOrCreatePassMock.mockImplementation(async () => ({
      publicPassId: null,
      isNew: false,
      referralOutcome: "none",
    }));

    const res = await POST(bearerReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "ONBOARDING_SAVE_FAILED", retryable: true });
    expect(body.error.message).toBe("Could not save your progress");
  });

  it("surfaces a read failure as a retryable 503", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.selectError = { message: "connection reset" };

    const res = await POST(bearerReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.passes.set("u1", null);
    const res = await POST(bearerReq());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
