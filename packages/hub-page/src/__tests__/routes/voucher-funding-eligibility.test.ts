/**
 * GET /api/voucher-funding/:allocationId/eligibility proxies to Akiba-Platform,
 * forwarding the member's own session token — same contract as the claim route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.AKIBA_API_URL = "https://platform.test";

const state = vi.hoisted(() => ({
  session: null as { user: { id: string }; access_token: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.session?.user ?? null } }),
      getSession: async () => ({ data: { session: state.session } }),
    },
  }),
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
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires a signed-in session before calling Platform", async () => {
    const res = await callRoute();
    expect(res.status).toBe(401);
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
    expect(mockFetch).toHaveBeenCalledWith(
      "https://platform.test/api/v1/voucher-funding-allocations/alloc-1/eligibility",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-abc" }) }),
    );
  });

  it("returns 502 when Platform is unreachable, without throwing", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await callRoute();
    expect(res.status).toBe(502);
  });
});
