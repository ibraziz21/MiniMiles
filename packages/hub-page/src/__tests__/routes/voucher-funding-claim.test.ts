/**
 * POST /api/voucher-funding/:allocationId/claim proxies to Akiba-Platform,
 * forwarding the member's own Supabase session token. These tests mock the
 * session and global fetch, and verify the safe-fallback / forwarding
 * contract — never that eligibility or claim logic itself is correct (that
 * lives in Akiba-Platform).
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

const { POST } = await import("@/app/api/voucher-funding/[allocationId]/claim/route");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callRoute(allocationId = "alloc-1") {
  return POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ allocationId }),
  });
}

describe("POST /api/voucher-funding/:allocationId/claim", () => {
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

  it("forwards the session token and a deterministic idempotency key, and returns claim data", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({ success: true, data: { voucherId: "v-1", status: "issued", expiresAt: "2026-10-01", idempotent: false } }, 201),
    );

    const res = await callRoute("alloc-1");
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.voucherId).toBe("v-1");
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
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockFetch.mockResolvedValueOnce(
      makeResponse({ error: { code: "VALIDATION_ERROR", message: "Eligibility requirements not met: pass_activated" } }, 422),
    );

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/eligibility/i);
  });

  it("returns 502 when Platform is unreachable, without throwing", async () => {
    state.session = { user: { id: "user-1" }, access_token: "token-abc" };
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const res = await callRoute();
    expect(res.status).toBe(502);
  });
});
