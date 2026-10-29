import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1" } as { id: string } | null,
  rpc: vi.fn(),
  snapshotError: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // Two reads now: linked wallet addresses, and the voucher's own snapshot
    // for its participant merchants.
    from: (table: string) => ({
      select: () => {
        const rows =
          table === "issued_vouchers"
            ? { data: state.snapshotError ? null : { expires_at: "2026-11-05T10:00:00Z", rules_snapshot: {
                title: "Market voucher", voucher_type: "percent_off", discount_percent: 10,
                maximum_discount_kes: 200, minimum_spend_kes: 300, terms_text: "One transaction only.",
              } }, error: state.snapshotError ? { message: "unavailable" } : null }
            : { data: [{ address: "0xABC" }], error: null };
        const result = Promise.resolve(rows);
        const chain = Object.assign(result, {
          eq: () => chain,
          maybeSingle: async () => rows,
          in: () => chain,
        });
        return chain;
      },
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
    state.snapshotError = false;
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

  it("keeps voucher expiry and immutable conditions separate from the QR token expiry", async () => {
    state.rpc.mockResolvedValue({ data: [{ ok: true, offer_title: "Edited title", voucher_type: "percent_off", discount_percent: 90 }], error: null });
    const body = await (await POST(new NextRequest("http://localhost/presentation", { method: "POST" }), context)).json();
    expect(body.entitlement).toMatchObject({ title: "Market voucher", discountPercent: 10, maximumDiscountKes: 200,
      minimumSpendKes: 300, terms: "One transaction only.", timing: { kind: "issued", expiresAt: "2026-11-05T10:00:00Z" } });
    expect(body.expires_at).not.toBe(body.entitlement.timing.expiresAt);
  });
  it("withholds the token when the authoritative display data cannot be loaded", async () => {
    state.rpc.mockResolvedValue({ data: [{ ok: true }], error: null }); state.snapshotError = true;
    const response = await POST(new NextRequest("http://localhost/presentation", { method: "POST" }), context);
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("token");
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
