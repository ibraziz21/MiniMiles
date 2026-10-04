/**
 * GET /api/voucher-funding/:allocationId/eligibility proxies to Akiba-Platform,
 * forwarding the member's own session token — same contract as the claim route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_FUNDED_VOUCHERS_HUB_ENABLED = "true";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "key";

const state = vi.hoisted(() => ({
  session: null as { user: { id: string }; access_token: string } | null,
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.session?.user ?? null } }),
      getSession: async () => ({ data: { session: state.session } }),
    },
  }),
}));
vi.mock("@/lib/akiba/fundedVoucherCountryEligibility", () => ({
  evaluateFundedVoucherCountryEligibility: async () => state.countryEligibility,
}));
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: async () => ({ expiredUnusedCount: 1, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: true }),
}));
vi.mock("@/lib/akiba/voucherUsername", () => ({
  getActiveUsernameForHubUser: async () => state.username,
}));

const { GET } = await import("@/app/api/voucher-funding/[allocationId]/eligibility/route");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callRoute(allocationId = "alloc-1") {
  return GET(new Request("http://localhost/x"), { params: Promise.resolve({ allocationId }) });
}

describe("GET /api/voucher-funding/:allocationId/eligibility", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    state.session = null;
    state.username = "amina";
    state.countryEligibility = { ok: true, eligible: true, fundCountry: "KE", memberCountry: "KE" };
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires a signed-in session before calling Platform", async () => {
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses to start when the Hub kill switch is off, before touching the session", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_HUB_ENABLED", "false");

    const res = await callRoute();

    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_HUB_ENABLED", "true");
  });

  it("requires an active username before returning a preview", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    state.username = null;

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.requirementsRemaining).toEqual(["username_required"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards the session token and returns the eligibility preview", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        success: true,
        data: { eligible: false, alreadyClaimed: false, requirementsRemaining: ["pass_activated"], allocationAvailable: true },
      }),
    );

    const res = await callRoute("alloc-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.requirementsRemaining).toEqual(["pass_activated"]);
    expect(body.claimFriction.requiresUsePlan).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://platform.test/api/v1/voucher-funding-allocations/alloc-1/eligibility",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) }),
    );
  });

  it("returns an ineligible preview for a member outside Kenya without calling Platform", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
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
    expect(body.eligible).toBe(false);
    expect(body.requirementsRemaining).toEqual(["profile_country_mismatch"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the profile-required reason for a member with no saved country", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    state.countryEligibility = {
      ok: true,
      eligible: false,
      fundCountry: "KE",
      memberCountry: null,
      reasonCode: "profile_country_required",
    };

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.requirementsRemaining).toEqual(["profile_country_required"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 502 when Platform is unreachable, without throwing", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await callRoute();
    expect(res.status).toBe(502);
  });
});
