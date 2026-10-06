/**
 * GET /api/v1/vouchers/funded/:allocationId/eligibility proxies to
 * Akiba-Platform, forwarding the actor's own access token — same contract
 * as the claim route.
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
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: async () => ({ expiredUnusedCount: 1, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: true }),
}));
vi.mock("@/lib/akiba/voucherUsername", () => ({
  getActiveUsernameForHubUser: async () => state.username,
}));

const { GET } = await import("@/app/api/v1/vouchers/funded/[allocationId]/eligibility/route");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callRoute(allocationId = "alloc-1") {
  return GET(new Request("http://localhost/api/v1/vouchers/funded/x/eligibility"), { params: { allocationId } });
}

describe("GET /api/v1/vouchers/funded/:allocationId/eligibility", () => {
  beforeEach(() => {
    mockFetch.mockReset();
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

  it("requires an active username before returning a preview", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    state.username = null;

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.requirementsRemaining).toEqual(["username_required"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the actor's access token and returns the eligibility preview", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        success: true,
        data: { eligible: false, alreadyClaimed: false, requirementsRemaining: ["pass_activated"], allocationAvailable: true },
      }),
    );

    const res = await callRoute("alloc-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.requirementsRemaining).toEqual(["pass_activated"]);
    expect(body.data.claimFriction.requiresUsePlan).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://platform.test/api/v1/voucher-funding-allocations/alloc-1/eligibility",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) }),
    );
  });

  it("returns an ineligible preview for a member outside Kenya without calling Platform", async () => {
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

    expect(res.status).toBe(200);
    expect(body.data.eligible).toBe(false);
    expect(body.data.requirementsRemaining).toEqual(["profile_country_mismatch"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 502 when Platform is unreachable, without throwing", async () => {
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "token-abc" };
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await callRoute();
    expect(res.status).toBe(502);
  });
});
