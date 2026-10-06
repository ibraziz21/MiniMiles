/**
 * POST /api/v1/vouchers/loyalty/:templateId/claim proxies to Akiba-Platform,
 * forwarding the actor's own access token. These tests mock the actor and
 * global fetch, and verify the safe-fallback/forwarding contract — never
 * that claim logic itself is correct (that lives in Akiba-Platform).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer"; accessToken: string } | null;

process.env.AKIBA_API_URL = "https://platform.test";

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

const mockRecordClaimIntent = vi.fn();
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: async () => ({ expiredUnusedCount: 0, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: false }),
  claimIntentIsValid: (confirmed: unknown) => confirmed === true,
  isVoucherUsePlan: (value: unknown) => typeof value === "string",
  recordVoucherClaimIntent: (...args: unknown[]) => mockRecordClaimIntent(...args),
}));

const { POST } = await import("@/app/api/v1/vouchers/loyalty/[templateId]/claim/route");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callRoute(templateId = "template-1", body: Record<string, unknown> = { intent_confirmed: true }, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/v1/vouchers/loyalty/x/claim", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }), { params: { templateId } });
}

describe("POST /api/v1/vouchers/loyalty/:templateId/claim", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockRecordClaimIntent.mockReset();
    state.actor = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 401 when unauthenticated", async () => {
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a bearer-authenticated mutation with the wrong content type", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    const res = await callRoute("template-1", { intent_confirmed: true }, { "content-type": "text/plain" });
    expect(res.status).toBe(415);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requires confirmation that the member intends to use the voucher", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    const res = await callRoute("template-1", { intent_confirmed: false });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the actor's access token and a deterministic idempotency key, and returns claim data", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({ success: true, data: { voucherId: "v-1", status: "issued", expiresAt: "2026-10-01", milesSpent: 50, idempotent: false } }, 201),
    );

    const res = await callRoute("template-1");
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.voucherId).toBe("v-1");
    expect(mockRecordClaimIntent).toHaveBeenCalledWith(expect.objectContaining({ voucherId: "v-1", flow: "loyalty_claim" }));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://platform.test/api/v1/voucher-offers/template-1/claim",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-abc",
          "Idempotency-Key": "hub-loyalty-claim:user-1:template-1",
        }),
      }),
    );
  });

  it("propagates a claim rejection from Platform as-is", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({ error: { code: "ALREADY_CLAIMED", message: "This offer has already been claimed." } }, 409),
    );

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("ALREADY_CLAIMED");
  });

  it("returns 502 when Platform is unreachable, without throwing", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await callRoute();
    expect(res.status).toBe(502);
  });
});
