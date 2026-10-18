import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  merchant: { id: "merchant-1" } as { id: string } | null,
  eligible: true,
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

const isEligibleMock = vi.fn();
const markHelpfulMock = vi.fn();
const unmarkHelpfulMock = vi.fn();
vi.mock("@/lib/merchants/verifiedVisitHelpful", () => ({
  isEligiblePublicVerifiedVisit: (...args: unknown[]) => isEligibleMock(...args),
  markVerifiedVisitHelpful: (...args: unknown[]) => markHelpfulMock(...args),
  unmarkVerifiedVisitHelpful: (...args: unknown[]) => unmarkHelpfulMock(...args),
}));

const { POST, DELETE } = await import("@/app/api/v1/merchants/[slug]/verified-visits/[visitId]/helpful/route");

function request(method: "POST" | "DELETE", origin?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("http://localhost/api/v1/merchants/acme/verified-visits/visit-1/helpful", {
    method,
    headers,
  });
}

const routeContext = { params: { slug: "acme", visitId: "visit-1" } };

describe("POST/DELETE verified visit Helpful", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.merchant = { id: "merchant-1" };
    state.eligible = true;
    getPublicMerchantMock.mockImplementation(async () => state.merchant);
    isEligibleMock.mockImplementation(async () => state.eligible);
  });

  it("requires authentication", async () => {
    expect((await POST(request("POST"), routeContext)).status).toBe(401);
  });

  it("rejects cross-origin cookie mutations", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "cookie" };
    const response = await POST(request("POST", "https://evil.example"), routeContext);
    expect(response.status).toBe(403);
  });

  it("never lets a hidden or wrong-merchant visit receive a reaction", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    state.eligible = false;

    const response = await POST(request("POST"), routeContext);

    expect(response.status).toBe(404);
    expect(isEligibleMock).toHaveBeenCalledWith("visit-1", "merchant-1");
    expect(markHelpfulMock).not.toHaveBeenCalled();
  });

  it("stores Helpful as a private actor-owned toggle", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };

    const response = await POST(request("POST"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual({ helpful: true });
    expect(markHelpfulMock).toHaveBeenCalledWith("user-1", "visit-1");
    expect(body.data).not.toHaveProperty("count");
  });

  it("removes only the actor's Helpful toggle", async () => {
    state.actor = { userId: "user-2", email: null, authMode: "bearer" };

    const response = await DELETE(request("DELETE"), routeContext);
    const body = await response.json();

    expect(body.data).toEqual({ helpful: false });
    expect(unmarkHelpfulMock).toHaveBeenCalledWith("user-2", "visit-1");
  });
});
