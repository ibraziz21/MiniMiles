import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  rpc: vi.fn(),
  request: null as unknown,
  partner: null as unknown,
  withinLimits: true,
  resolve: vi.fn(),
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

vi.mock("@/lib/rateLimit", () => ({ checkAllRateLimits: async () => state.withinLimits }));
vi.mock("@/lib/akiba/discoveryContributions", () => ({
  resolveMerchantContributionFromMilesIssuance: (...args: unknown[]) => state.resolve(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === "partners" ? state.partner : state.request,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

const contributionRoute = await import("@/app/api/v1/me/discovery-contributions/[id]/route");
const merchantRoute = await import("@/app/api/v1/me/discovery-contributions/merchant/[slug]/route");
const { parseContributionAnswers } = await import("@/lib/discovery/contributions");

const REQUEST_ID = "0b6a1c2e-5f3d-4c1a-9e8b-7d6c5b4a3f21";
const ANSWERS = {
  wouldRecommend: true,
  negativeReasonId: null,
  partySize: 2,
  partySizeIsSixPlus: false,
  experienceOptionIds: ["work"],
  items: [{ clientItemKey: "k1", rawLabel: "Chai", source: "customer_input", isRecommended: true }],
  idempotencyKey: "key-1",
};

function put(body: unknown) {
  return contributionRoute.PUT(
    new Request(`http://localhost/api/v1/me/discovery-contributions/${REQUEST_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: REQUEST_ID } },
  );
}

beforeEach(() => {
  state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
  state.rpc.mockReset();
  state.resolve.mockReset();
  state.request = null;
  state.partner = null;
  state.withinLimits = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/v1/me/discovery-contributions/:id", () => {
  it("requires a signed-in member", async () => {
    state.actor = null;
    expect((await put(ANSWERS)).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("saves the member's answers through the same RPC as the web", async () => {
    state.rpc.mockResolvedValue({ data: [{ ok: true, contribution_id: "c1" }], error: null });

    const res = await put(ANSWERS);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ contributionId: "c1" });
    expect(state.rpc).toHaveBeenCalledWith("submit_discovery_contribution", expect.objectContaining({
      p_request_id: REQUEST_ID,
      p_hub_user_id: "u1",
      p_would_recommend: true,
      p_items: ANSWERS.items,
      p_idempotency_key: "key-1",
    }));
    // No private note sent means none is changed.
    expect(state.rpc.mock.calls[0][1]).not.toHaveProperty("p_private_note");
  });

  it("rejects malformed answers before the database sees them", async () => {
    const res = await put({ ...ANSWERS, items: Array(5).fill(ANSWERS.items[0]) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_ANSWERS");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("explains a closed or expired visit", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message: "expired" } });
    expect((await (await put(ANSWERS)).json()).error.code).toBe("CONTRIBUTION_EXPIRED");
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "state" } });
    const closed = await put(ANSWERS);
    expect(closed.status).toBe(409);
    expect((await closed.json()).error.code).toBe("CONTRIBUTION_CLOSED");
  });

  it("is rate limited", async () => {
    state.withinLimits = false;
    expect((await put(ANSWERS)).status).toBe(429);
  });
});

describe("GET /api/v1/me/discovery-contributions/:id", () => {
  const get = () =>
    contributionRoute.GET(new Request(`http://localhost/api/v1/me/discovery-contributions/${REQUEST_ID}`), {
      params: { id: REQUEST_ID },
    });

  it("returns the member's own request with saved answers, never a withdrawn one", async () => {
    state.request = {
      id: REQUEST_ID,
      state: "submitted",
      expires_at: "2099-01-01T00:00:00Z",
      template_snapshot: { recommendation_prompt: "Would you recommend {{merchantName}}?" },
      merchant: { name: "Kahawa Corner", slug: "kahawa-corner" },
      contribution: {
        id: "c1",
        would_recommend: true,
        negative_reason_id: null,
        party_size: 2,
        party_size_is_six_plus: false,
        experience_option_ids: ["work"],
        withdrawn_at: null,
        private_note: null,
        items: [{ is_recommended: true, mention: { client_item_key: "k1", raw_label: "Chai" } }],
      },
    };

    const body = (await (await get()).json()).data.request;

    expect(body).toMatchObject({
      id: REQUEST_ID,
      merchant: { name: "Kahawa Corner", slug: "kahawa-corner" },
      contribution: { id: "c1", privateNote: "", items: [{ clientItemKey: "k1", rawLabel: "Chai", isRecommended: true }] },
    });

    (state.request as { contribution: { withdrawn_at: string } }).contribution.withdrawn_at = "2026-11-01T00:00:00Z";
    expect((await (await get()).json()).data.request.contribution).toBeNull();
  });

  it("answers 404 for someone else's request", async () => {
    expect((await get()).status).toBe(404);
  });
});

describe("GET /api/v1/me/discovery-contributions/merchant/:slug", () => {
  const get = (slug = "kahawa-corner") =>
    merchantRoute.GET(new Request(`http://localhost/api/v1/me/discovery-contributions/merchant/${slug}`), {
      params: { slug },
    });

  it("finds the visit to recommend from, using the web entry page's resolver", async () => {
    state.partner = { id: "m1" };
    state.resolve.mockResolvedValue({ status: "ready", requestId: REQUEST_ID, issuanceFound: true });

    expect((await (await get()).json()).data).toEqual({ status: "ready", requestId: REQUEST_ID });
    expect(state.resolve).toHaveBeenCalledWith({ hubUserId: "u1", email: "a@example.com", merchantId: "m1" });
  });

  it("says when there is nothing to recommend yet", async () => {
    state.partner = { id: "m1" };
    state.resolve.mockResolvedValue({ status: "no_issuance", requestId: null, issuanceFound: false });
    expect((await (await get()).json()).data).toEqual({ status: "no_issuance", requestId: null });
  });

  it("answers 404 for an unknown or malformed place", async () => {
    expect((await get()).status).toBe(404);
    expect((await get("../etc")).status).toBe(404);
    expect(state.resolve).not.toHaveBeenCalled();
  });
});

describe("parseContributionAnswers", () => {
  it("keeps the web route's rules", () => {
    expect(parseContributionAnswers({ ...ANSWERS, idempotencyKey: "" })).toEqual({ ok: false, error: "invalid_idempotency_key" });
    expect(parseContributionAnswers({ ...ANSWERS, wouldRecommend: undefined })).toEqual({ ok: false, error: "invalid_would_recommend" });
    expect(parseContributionAnswers({ ...ANSWERS, partySize: 6 })).toEqual({ ok: false, error: "invalid_party_size" });
    expect(parseContributionAnswers({ ...ANSWERS, privateNote: "x".repeat(301) })).toEqual({ ok: false, error: "invalid_private_note" });
    expect(parseContributionAnswers({ ...ANSWERS, items: [{ ...ANSWERS.items[0], source: "made_up" }] }))
      .toEqual({ ok: false, error: "invalid_items" });
    expect(parseContributionAnswers({ ...ANSWERS, wouldRecommend: null }).ok).toBe(true);
  });
});
