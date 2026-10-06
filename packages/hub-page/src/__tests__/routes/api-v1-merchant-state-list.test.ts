import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  balance: 42 as number | null,
  savedIds: new Set<string>(),
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

const getSignedInBalanceMock = vi.fn();
vi.mock("@/lib/merchants/enrich", () => ({
  getSignedInBalance: (...args: unknown[]) => getSignedInBalanceMock(...args),
}));

const listSavedMerchantIdsMock = vi.fn();
vi.mock("@/lib/merchants/savedMerchants", () => ({
  listSavedMerchantIds: (...args: unknown[]) => listSavedMerchantIdsMock(...args),
}));

const { GET } = await import("@/app/api/v1/me/merchant-state/route");

function req(query: string) {
  return new Request(`http://localhost/api/v1/me/merchant-state${query}`);
}

describe("GET /api/v1/me/merchant-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.balance = 42;
    state.savedIds = new Set();
    getSignedInBalanceMock.mockImplementation(async () => state.balance);
    listSavedMerchantIdsMock.mockImplementation(async () => state.savedIds);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req("?ids=m1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when ids is empty", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req("?ids="));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_IDS");
  });

  it("returns 400 when more than 50 ids are requested", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const ids = Array.from({ length: 51 }, (_, i) => `m${i}`).join(",");
    const res = await GET(req(`?ids=${ids}`));
    expect(res.status).toBe(400);
  });

  it("dedupes and trims ids before querying", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    await GET(req("?ids= m1 ,m2,m1"));
    expect(listSavedMerchantIdsMock).toHaveBeenCalledWith("u1", ["m1", "m2"]);
  });

  it("returns the member's own balance and only the requested ids that are actually saved", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.balance = 120;
    state.savedIds = new Set(["m1"]);
    const res = await GET(req("?ids=m1,m2"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ balance: 120, saved: ["m1"] });
    expect(getSignedInBalanceMock).toHaveBeenCalledWith("u1", "a@example.com");
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req("?ids=m1"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
