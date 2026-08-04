import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  existingTokenHash: "existing-token-hash" as string | null,
  existingClick: { status: "accepted", expires_at: "2099-01-01T00:00:00.000Z" } as Record<string, unknown> | null,
  rpc: vi.fn(),
}));

vi.mock("@/lib/akiba/referral-token", () => ({
  createReferralToken: () => ({ cookieValue: "new-cookie-value", tokenHash: "new-token-hash" }),
  verifyReferralCookie: () => state.existingTokenHash,
  REFERRAL_COOKIE_NAME: "akiba_ref",
  REFERRAL_COOKIE_MAX_AGE_SECONDS: 30 * 24 * 60 * 60,
}));

vi.mock("@/lib/akiba/referral", () => ({
  normalizeReferralCode: (code: string) => code.toUpperCase(),
  isPlausibleReferralCode: () => true,
  hashClickSignal: (value: string, kind: string) => `${kind}:${value}`,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.existingClick, error: null }) }),
      }),
    }),
  }),
}));

const { GET } = await import("@/app/r/[code]/route");
const { POST: clearAttribution } = await import("@/app/api/auth/clear-referral-attribution/route");

beforeEach(() => {
  state.existingTokenHash = "existing-token-hash";
  state.existingClick = { status: "accepted", expires_at: "2099-01-01T00:00:00.000Z" };
  state.rpc.mockReset();
});

describe("referral attribution lifecycle", () => {
  it("keeps the first valid referral instead of silently overwriting it", async () => {
    const req = new NextRequest("https://pass.test/r/NEWCODE", {
      headers: { cookie: "akiba_ref=existing-cookie" },
    });
    const response = await GET(req, { params: { code: "NEWCODE" } });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pass.test/join?src=referral");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("accepts and stores a referral when no valid first touch exists", async () => {
    state.existingTokenHash = null;
    state.existingClick = null;
    state.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });
    const req = new NextRequest("https://pass.test/r/NEWCODE");

    const response = await GET(req, { params: { code: "NEWCODE" } });

    expect(response.status).toBe(302);
    expect(state.rpc).toHaveBeenCalledWith("accept_referral_click", expect.objectContaining({
      p_code: "NEWCODE",
      p_token_hash: "new-token-hash",
    }));
    expect(response.headers.get("set-cookie")).toContain("akiba_ref=new-cookie-value");
  });

  it("clears HttpOnly attribution during logout/account switching", async () => {
    const response = await clearAttribution();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("akiba_ref=");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });
});
