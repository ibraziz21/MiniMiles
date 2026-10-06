/**
 * POST /api/v1/vouchers/funded/:allocationId/claim proxies to Akiba-Platform,
 * forwarding the actor's own access token. These tests mock the actor and
 * global fetch, and verify the safe-fallback/forwarding contract — never
 * that eligibility or claim logic itself is correct (that lives in
 * Akiba-Platform).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer"; accessToken: string } | null;

process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_FUNDED_VOUCHERS_HUB_ENABLED = "true";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "key";

const state = vi.hoisted(() => ({
  actor: null as Actor,
  username: "amina" as string | null,
  countryEligibility: { ok: true, eligible: true, fundCountry: "KE", memberCountry: "KE" } as
    | {
        ok: true;
        eligible: boolean;
        fundCountry: string;
        memberCountry: string | null;
        reasonCode?: "profile_country_required" | "profile_country_mismatch";
      }
    | { ok: false; reason: "allocation_not_found" | "country_policy_unavailable" },
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
vi.mock("@/lib/akiba/fundedVoucherCountryEligibility", () => ({
  evaluateFundedVoucherCountryEligibility: async () => state.countryEligibility,
}));
vi.mock("@/lib/akiba/voucherUsername", () => ({
  getActiveUsernameForHubUser: async () => state.username,
}));
const mockRecordClaimIntent = vi.fn();
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: async () => ({ expiredUnusedCount: 0, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: false }),
  claimIntentIsValid: (confirmed: unknown) => confirmed === true,
  isVoucherUsePlan: (value: unknown) => typeof value === "string",
  recordVoucherClaimIntent: (...args: unknown[]) => mockRecordClaimIntent(...args),
}));

const { POST } = await import("@/app/api/v1/vouchers/funded/[allocationId]/claim/route");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callRoute(allocationId = "alloc-1", body: Record<string, unknown> = { intent_confirmed: true }, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/v1/vouchers/funded/x/claim", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }), { params: { allocationId } });
}

describe("POST /api/v1/vouchers/funded/:allocationId/claim", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockRecordClaimIntent.mockReset();
    state.actor = null;
    state.username = "amina";
    state.countryEligibility = { ok: true, eligible: true, fundCountry: "KE", memberCountry: "KE" };
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses to start when the Hub kill switch is off, before resolving the actor", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_HUB_ENABLED", "false");

    const res = await callRoute();

    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_HUB_ENABLED", "true");
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a bearer-authenticated mutation with the wrong content type", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    const res = await callRoute("alloc-1", { intent_confirmed: true }, { "content-type": "text/plain" });
    expect(res.status).toBe(415);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requires confirmation that the member intends to use the voucher", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    const res = await callRoute("alloc-1", { intent_confirmed: false });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requires an active username before forwarding a new claim", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    state.username = null;

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("USERNAME_REQUIRED");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a member outside Kenya before calling Platform", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    state.countryEligibility = {
      ok: true,
      eligible: false,
      fundCountry: "KE",
      memberCountry: "UG",
      reasonCode: "profile_country_mismatch",
    };

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("COUNTRY_NOT_ELIGIBLE");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a member with no saved profile country before calling Platform", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    state.countryEligibility = {
      ok: true,
      eligible: false,
      fundCountry: "KE",
      memberCountry: null,
      reasonCode: "profile_country_required",
    };

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("COUNTRY_PROFILE_REQUIRED");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the actor's access token and a deterministic idempotency key, and returns claim data", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({ success: true, data: { voucherId: "v-1", status: "issued", expiresAt: "2026-10-01", idempotent: false } }, 201),
    );

    const res = await callRoute("alloc-1");
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.voucherId).toBe("v-1");
    expect(mockRecordClaimIntent).toHaveBeenCalledWith(expect.objectContaining({ voucherId: "v-1", flow: "funded_claim" }));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://platform.test/api/v1/voucher-funding-allocations/alloc-1/claim",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-abc",
          "Idempotency-Key": "hub-claim:user-1:alloc-1",
        }),
      }),
    );
  });

  it("propagates an ineligibility rejection from Platform as-is", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({ error: { code: "VALIDATION_ERROR", message: "Eligibility requirements not met: pass_activated" } }, 422),
    );

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.message).toMatch(/eligibility/i);
  });

  it("returns 502 when Platform is unreachable, without throwing", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await callRoute();
    expect(res.status).toBe(502);
  });
});
