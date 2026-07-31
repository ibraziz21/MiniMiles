import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "hub-user-1" } },
      }),
    },
  }),
}));

vi.mock("@/lib/vouchers/issuance", () => ({
  userOwnsVoucher: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "hub_user_wallets") {
        return {
          select: () => {
            const result = Promise.resolve({ data: [{ address: "0xabc" }], error: null });
            const chain = Object.assign(result, { eq: () => chain });
            return chain;
          },
        };
      }

      const row = table === "issued_vouchers"
        ? {
            id: "voucher-1",
            status: "pending",
            burn_tx_hash: null,
            recovery_state: "burn_ambiguous",
          }
        : null;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      };
    },
  }),
}));

const { GET } = await import("@/app/api/shop/vouchers/[id]/status/route");

describe("GET /api/shop/vouchers/[id]/status", () => {
  it("surfaces legacy burn ambiguity instead of looking pending forever", async () => {
    const response = await GET(
      new Request("http://localhost/api/shop/vouchers/voucher-1/status"),
      { params: Promise.resolve({ id: "voucher-1" }) },
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.voucher_status).toBe("pending");
    expect(body.intent_state).toBeNull();
    expect(body.recovery_state).toBe("burn_ambiguous");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
