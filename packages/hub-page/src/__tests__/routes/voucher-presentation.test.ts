import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1" } as { id: string } | null,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ address: "0xABC" }], error: null }),
      }),
    }),
    rpc: state.rpc,
  }),
}));

const { POST, DELETE } = await import("@/app/api/shop/vouchers/[id]/presentation/route");

const context = { params: Promise.resolve({ id: "voucher-1" }) };

describe("voucher presentation route", () => {
  beforeEach(() => {
    state.user = { id: "hub-user-1" };
    state.rpc.mockReset();
  });

  it("returns an uncached 401 without minting for an anonymous request", async () => {
    state.user = null;

    const response = await POST(
      new NextRequest("http://localhost/api/shop/vouchers/voucher-1/presentation", { method: "POST" }),
      context
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("returns a strict 256-bit token once and sends only its hash to PostgreSQL", async () => {
    state.rpc.mockResolvedValue({
      data: [{ ok: true, token_version: 3, offer_title: "Lunch", merchant_id: "partner-1" }],
      error: null,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/shop/vouchers/voucher-1/presentation", { method: "POST" }),
      context
    );
    const body = await response.json() as { token: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.token).toMatch(/^AKV1\.[A-Za-z0-9_-]{43}$/);

    const [, params] = state.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_token_hash).toBe(createHash("sha256").update(body.token).digest("hex"));
    expect(JSON.stringify(params)).not.toContain(body.token);
    expect(params.p_wallet_addresses).toEqual(["0xabc"]);
  });

  it("does not return the generated raw token when PostgreSQL rejects presentation", async () => {
    state.rpc.mockResolvedValue({
      data: [{ ok: false, token_version: 0 }],
      error: null,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/shop/vouchers/voucher-1/presentation", { method: "POST" }),
      context
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({ error: "Voucher cannot be presented" });
    expect(body).not.toHaveProperty("token");
  });

  it("revokes with the authenticated user and uncached response", async () => {
    state.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });

    const response = await DELETE(
      new NextRequest("http://localhost/api/shop/vouchers/voucher-1/presentation", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.rpc).toHaveBeenCalledWith("revoke_voucher_presentation_atomic", {
      p_voucher_id: "voucher-1",
      p_hub_user_id: "hub-user-1",
      p_wallet_addresses: ["0xabc"],
    });
  });
});
