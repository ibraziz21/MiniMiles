import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireActorMock = vi.fn();
const assertMutationAllowedMock = vi.fn();

vi.mock("@/lib/auth/requestActor", () => ({
  requireActor: (...args: unknown[]) => requireActorMock(...args),
  UnauthorizedError: class UnauthorizedError extends Error {
    status = 401;
    code = "UNAUTHORIZED";
  },
}));

vi.mock("@/lib/api/v1/mutationGuard", () => ({
  assertMutationAllowed: (...args: unknown[]) => assertMutationAllowedMock(...args),
  ForbiddenOriginError: class ForbiddenOriginError extends Error {},
  UnsupportedContentTypeError: class UnsupportedContentTypeError extends Error {},
}));

const route = await import("@/app/api/v1/merchant-offers/[offerId]/reminder/route");

const actor = {
  userId: "fixture-user",
  email: "fixture@example.com",
  authMode: "bearer" as const,
  accessToken: "fixture-token",
};

describe("development offer fixture reminders", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    requireActorMock.mockResolvedValue(actor);
    assertMutationAllowedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("saves, reads, and removes a fixture reminder without calling an upstream service", async () => {
    const params = { offerId: "dev-offer-coffee-pairing" };
    const putRequest = new Request("http://localhost/api/v1/merchant-offers/dev-offer-coffee-pairing/reminder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadMinutes: 60 }),
    });

    const putResponse = await route.PUT(putRequest, { params });
    expect(putResponse.status).toBe(200);
    expect((await putResponse.json()).data.reminder).toEqual({ leadMinutes: 60 });

    const getResponse = await route.GET(new Request(putRequest.url), { params });
    expect((await getResponse.json()).data.reminder).toEqual({ leadMinutes: 60 });

    const deleteResponse = await route.DELETE(new Request(putRequest.url, { method: "DELETE" }), { params });
    expect((await deleteResponse.json()).data.reminder).toBeNull();
  });

  it("returns 409 for a fixture that has reminders disabled", async () => {
    const request = new Request("http://localhost/api/v1/merchant-offers/dev-offer-no-reminders/reminder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadMinutes: 30 }),
    });

    const response = await route.PUT(request, { params: { offerId: "dev-offer-no-reminders" } });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REMINDERS_DISABLED");
  });
});
