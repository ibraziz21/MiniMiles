import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  walletAddress: "0xabc" as string | null,
  displayName: "Member Name",
  publicPassId: "pass-123" as string | null,
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

const resolveHubProfileMock = vi.fn();
vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: (...args: unknown[]) => resolveHubProfileMock(...args),
}));

const getOrCreatePassMock = vi.fn();
vi.mock("@/lib/akiba/pass", () => ({
  getOrCreatePass: (...args: unknown[]) => getOrCreatePassMock(...args),
}));

const { GET } = await import("@/app/api/v1/me/pass/route");

function req() {
  return new Request("http://localhost/api/v1/me/pass");
}

describe("GET /api/v1/me/pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.walletAddress = "0xabc";
    state.displayName = "Member Name";
    state.publicPassId = "pass-123";

    resolveHubProfileMock.mockImplementation(async () => ({
      rows: [],
      activeRow: null,
      walletAddress: state.walletAddress,
      displayName: state.displayName,
      needsPicker: false,
    }));
    getOrCreatePassMock.mockImplementation(async () => ({
      publicPassId: state.publicPassId,
      isNew: false,
      referralOutcome: "none",
    }));
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 422 when the actor has no email", async () => {
    state.actor = { userId: "u1", email: null, authMode: "bearer" };
    const res = await GET(req());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PASS_REQUIRES_EMAIL");
  });

  it("resolves the real wallet address via resolveHubProfile before calling getOrCreatePass", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    await GET(req());
    expect(resolveHubProfileMock).toHaveBeenCalledWith({ userId: "u1", email: "a@example.com" });
    expect(getOrCreatePassMock).toHaveBeenCalledWith({
      userId: "u1",
      email: "a@example.com",
      walletAddress: "0xabc",
    });
  });

  it("returns publicPassId, a matching qrPayload, displayName, and email", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      publicPassId: "pass-123",
      qrPayload: "akiba-pass:v1:pass-123",
      displayName: "Member Name",
      email: "a@example.com",
    });
  });

  it("returns a retryable 503 when getOrCreatePass yields no publicPassId", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.publicPassId = null;
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("PASS_UNAVAILABLE");
    expect(body.error.retryable).toBe(true);
  });

  it("clears the referral cookie for a cookie-authenticated caller", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "cookie" };
    const res = await GET(req());
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("never attempts to clear a cookie for a bearer-authenticated caller", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
