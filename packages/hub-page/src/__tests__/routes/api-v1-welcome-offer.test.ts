import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  rpc: vi.fn(),
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: state.rpc }),
}));

const { GET, POST } = await import("@/app/api/v1/me/welcome-offer/route");
const { toWelcomeOffer } = await import("@/lib/akiba/welcomeOffer");

const VOUCHER = "0b6a1c2e-5f3d-4c1a-9e8b-7d6c5b4a3f21";
const AWARDED = {
  state: "awarded",
  voucherId: VOUCHER,
  discountPercent: 25,
  maximumDiscountKes: 250,
  minimumSpendKes: 1000,
  expiresAt: "2026-11-17T12:00:00+03:00",
  enrolledAt: "2026-11-10T12:00:00+03:00",
};

function req(method: "GET" | "POST", headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/v1/me/welcome-offer", { method, headers });
}

async function body(res: Response) {
  return (await res.json()).data.welcomeOffer;
}

describe("/api/v1/me/welcome-offer", () => {
  beforeEach(() => {
    state.actor = null;
    state.rpc.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("requires a signed-in member", async () => {
    expect((await POST(req("POST"))).status).toBe(401);
    expect((await GET(req("GET"))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("enrols an app member and returns the committed voucher", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.rpc.mockResolvedValue({ data: AWARDED, error: null });

    const res = await POST(req("POST"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.rpc).toHaveBeenCalledWith("enrol_welcome_offer", { p_hub_user_id: "u1" });
    expect(await body(res)).toEqual({
      state: "awarded",
      voucherId: VOUCHER,
      discountPercent: 25,
      maximumDiscountKes: 250,
      minimumSpendKes: 1000,
      expiresAt: "2026-11-17T09:00:00.000Z",
    });
  });

  it("never enrols from the web, but still shows an offer the member already has", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "cookie" };
    state.rpc.mockResolvedValueOnce({ data: { state: "none" }, error: null });
    expect(await body(await POST(req("POST", { "content-type": "application/json", origin: "http://localhost" }))))
      .toEqual({ state: "unavailable", reason: "unsupported_channel" });

    state.rpc.mockResolvedValueOnce({ data: AWARDED, error: null });
    expect((await body(await POST(req("POST", { "content-type": "application/json", origin: "http://localhost" })))).state)
      .toBe("awarded");
    expect(state.rpc.mock.calls.map((call) => call[0])).toEqual(["get_welcome_offer", "get_welcome_offer"]);
  });

  it("reads without enrolling", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.rpc.mockResolvedValue({ data: { state: "none" }, error: null });

    expect(await body(await GET(req("GET", {})))).toEqual({ state: "none" });
    expect(state.rpc).toHaveBeenCalledWith("get_welcome_offer", { p_hub_user_id: "u1" });
  });

  it("answers with a temporary failure rather than an error when the database fails", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await POST(req("POST"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ state: "unavailable", reason: "temporary_failure" });
  });
});

describe("toWelcomeOffer", () => {
  it("passes known reasons through and hides internal detail", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(toWelcomeOffer({ state: "unavailable", reason: "campaign_full", detail: "QUANTITY_EXHAUSTED" }, "t"))
      .toEqual({ state: "unavailable", reason: "campaign_full" });
    expect(toWelcomeOffer({ state: "unavailable", reason: "something_new" }, "t"))
      .toEqual({ state: "unavailable", reason: "temporary_failure" });
  });

  it("refuses a malformed award rather than showing a voucher that isn't there", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(toWelcomeOffer({ ...AWARDED, voucherId: "nope" }, "t")).toEqual({ state: "unavailable", reason: "temporary_failure" });
    expect(toWelcomeOffer({ ...AWARDED, expiresAt: null }, "t")).toEqual({ state: "unavailable", reason: "temporary_failure" });
    expect(toWelcomeOffer({ ...AWARDED, minimumSpendKes: null }, "t")).toEqual({ state: "unavailable", reason: "temporary_failure" });
    expect(toWelcomeOffer({ ...AWARDED, discountPercent: "25" }, "t")).toMatchObject({ discountPercent: 25 });
  });
});
