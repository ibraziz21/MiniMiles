import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: {
    merchantUserId: "merchant-user-1",
    partnerId: "partner-1",
    role: "manager",
  } as Record<string, unknown> | null,
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireMerchantSession: async () => state.session,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: state.rpc },
}));

const { POST: inspect } = await import("@/app/api/vouchers/scan/inspect/route");
const { POST: redeem } = await import("@/app/api/vouchers/scan/redeem/route");

const TOKEN = `AKV1.${Buffer.alloc(32, 7).toString("base64url")}`;

function request(path: string, token: string, grossAmount = 10) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, gross_amount_cusd: grossAmount }),
  });
}

describe("merchant voucher scan routes", () => {
  beforeEach(() => {
    state.session = {
      merchantUserId: "merchant-user-1",
      partnerId: "partner-1",
      role: "manager",
    };
    state.rpc.mockReset();
  });

  it("rejects malformed tokens before calling PostgreSQL", async () => {
    const inspectResponse = await inspect(request("/api/vouchers/scan/inspect", "AKV1.short"));
    const redeemResponse = await redeem(request("/api/vouchers/scan/redeem", "AKV1.short"));

    expect(await inspectResponse.json()).toEqual({
      valid: false,
      invalid_reason: "INVALID",
      voucher_id: null,
      offer_title: null,
      voucher_type: null,
      discount_percent: null,
      discount_cusd: null,
      merchant_name: null,
      applicable_category: null,
      token_expires_at: null,
    });
    expect(await redeemResponse.json()).toEqual({
      ok: false,
      error: "Voucher code is invalid or unavailable",
      code: "INVALID",
    });
    expect(inspectResponse.headers.get("cache-control")).toContain("no-store");
    expect(redeemResponse.headers.get("cache-control")).toContain("no-store");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("keeps all inspect failures generic and derives partner scope from the session", async () => {
    state.rpc.mockResolvedValue({
      data: [{ valid: false, invalid_reason: "WRONG_MERCHANT", voucher_id: null }],
      error: null,
    });

    const response = await inspect(request("/api/vouchers/scan/inspect", TOKEN));

    expect(await response.json()).toMatchObject({
      valid: false,
      invalid_reason: "INVALID",
      voucher_id: null,
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "inspect_voucher_presentation",
      expect.objectContaining({ p_partner_id: "partner-1" })
    );
  });

  it("returns the same redeem response for every database-level invalid result", async () => {
    state.rpc.mockResolvedValue({
      data: [{ ok: false, voucher_id: null, error_code: "INVALID" }],
      error: null,
    });

    const response = await redeem(request("/api/vouchers/scan/redeem", TOKEN));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Voucher code is invalid or unavailable",
      code: "INVALID",
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "redeem_voucher_in_store_atomic",
      expect.objectContaining({
        p_partner_id: "partner-1",
        p_merchant_user_id: "merchant-user-1",
        p_gross_amount_cusd: 10,
      })
    );
  });

  it("rejects invalid gross amounts before calling PostgreSQL", async () => {
    const response = await redeem(request("/api/vouchers/scan/redeem", TOKEN, 0));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Enter a valid gross order amount" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("returns an uncached success without exposing the token", async () => {
    state.rpc.mockResolvedValue({
      data: [{ ok: true, voucher_id: "voucher-1", offer_title: "Lunch" }],
      error: null,
    });

    const response = await redeem(request("/api/vouchers/scan/redeem", TOKEN));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({ ok: true, voucher_id: "voucher-1", offer_title: "Lunch" });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
