import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  merchant: null as { id: string } | null,
  shouldThrowUnavailable: false,
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

class MockDirectoryUnavailableError extends Error {}
const getPublicMerchantMock = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  DirectoryUnavailableError: MockDirectoryUnavailableError,
  getPublicMerchant: (...args: unknown[]) => getPublicMerchantMock(...args),
}));

const saveMerchantMock = vi.fn();
const unsaveMerchantMock = vi.fn();
vi.mock("@/lib/merchants/savedMerchants", () => ({
  saveMerchant: (...args: unknown[]) => saveMerchantMock(...args),
  unsaveMerchant: (...args: unknown[]) => unsaveMerchantMock(...args),
}));

// assertMutationAllowed is NOT mocked — the real guard (and the real
// isSameOriginRequest it wraps) runs so this test proves the guard's
// production behavior, not a stand-in for it.
const { POST, DELETE } = await import("@/app/api/v1/merchants/[slug]/save/route");

function cookieSameOriginReq(method: "POST" | "DELETE") {
  return new Request("http://localhost/api/v1/merchants/acme/save", {
    method,
    headers: { origin: "http://localhost", "content-type": "application/json" },
  });
}

function cookieCrossOriginReq(method: "POST" | "DELETE") {
  return new Request("http://localhost/api/v1/merchants/acme/save", {
    method,
    headers: { origin: "https://evil.example", "content-type": "application/json" },
  });
}

function bearerNoOriginReq(method: "POST" | "DELETE", contentType = "application/json") {
  return new Request("http://localhost/api/v1/merchants/acme/save", {
    method,
    headers: { "content-type": contentType },
  });
}

function params() {
  return { params: { slug: "acme" } };
}

describe("POST/DELETE /api/v1/merchants/[slug]/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.merchant = { id: "m1" };
    state.shouldThrowUnavailable = false;

    getPublicMerchantMock.mockImplementation(async () => {
      if (state.shouldThrowUnavailable) throw new MockDirectoryUnavailableError("db down");
      return state.merchant;
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(cookieSameOriginReq("POST"), params());
    expect(res.status).toBe(401);
  });

  it("rejects a cookie-authenticated cross-origin mutation with 403", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "cookie" };
    const res = await POST(cookieCrossOriginReq("POST"), params());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows a cookie-authenticated same-origin mutation", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "cookie" };
    const res = await POST(cookieSameOriginReq("POST"), params());
    expect(res.status).toBe(200);
  });

  it("allows a bearer-authenticated mutation with no Origin header at all", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await POST(bearerNoOriginReq("POST"), params());
    expect(res.status).toBe(200);
  });

  it("rejects a bearer-authenticated mutation with the wrong content type", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await POST(bearerNoOriginReq("POST", "text/plain"), params());
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("returns 404 for an unresolvable slug", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.merchant = null;
    const res = await POST(bearerNoOriginReq("POST"), { params: { slug: "nope" } });
    expect(res.status).toBe(404);
  });

  it("returns 503 when the directory is unavailable", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.shouldThrowUnavailable = true;
    const res = await POST(bearerNoOriginReq("POST"), params());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("DIRECTORY_UNAVAILABLE");
  });

  it("POST saves the resolved merchant for the actor and returns saved: true", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await POST(bearerNoOriginReq("POST"), params());
    const body = await res.json();
    expect(body.data).toEqual({ saved: true });
    expect(saveMerchantMock).toHaveBeenCalledWith("u1", "m1");
  });

  it("DELETE unsaves the resolved merchant for the actor and returns saved: false", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await DELETE(bearerNoOriginReq("DELETE"), params());
    const body = await res.json();
    expect(body.data).toEqual({ saved: false });
    expect(unsaveMerchantMock).toHaveBeenCalledWith("u1", "m1");
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await POST(bearerNoOriginReq("POST"), params());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
