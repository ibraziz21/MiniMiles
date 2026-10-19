import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = {
  userId: string;
  email: string | null;
  authMode: "cookie" | "bearer";
  accessToken: string;
} | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
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

const assertMutationAllowedMock = vi.fn();
vi.mock("@/lib/api/v1/mutationGuard", () => ({
  assertMutationAllowed: (...args: unknown[]) => assertMutationAllowedMock(...args),
  ForbiddenOriginError: class ForbiddenOriginError extends Error {},
  UnsupportedContentTypeError: class UnsupportedContentTypeError extends Error {},
}));

const { POST } = await import("@/app/api/v1/me/pass/token/route");

function request() {
  return new Request("http://localhost/api/v1/me/pass/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "request-1",
    },
  });
}

describe("POST /api/v1/me/pass/token", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    assertMutationAllowedMock.mockReset();
    state.actor = {
      userId: "user-1",
      email: "member@example.com",
      authMode: "bearer",
      accessToken: "member-access-token",
    };
    process.env.AKIBA_API_URL = "https://platform.example";
  });

  it("returns 401 when the member is unauthenticated", async () => {
    state.actor = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("forwards the member token and returns a private live presentation", async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "akiba-id:v1:live-token", expiresAt, ttlSeconds: 300 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual({ token: "akiba-id:v1:live-token", expiresAt, ttlSeconds: 300 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://platform.example/api/v1/me/presentation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer member-access-token" }),
        cache: "no-store",
      }),
    );
    expect(assertMutationAllowedMock).toHaveBeenCalledWith(expect.any(Request), state.actor);
  });

  it("returns a retryable gateway error without leaking an upstream body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "internal detail" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toMatchObject({
      code: "PASS_PRESENTATION_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });
});
