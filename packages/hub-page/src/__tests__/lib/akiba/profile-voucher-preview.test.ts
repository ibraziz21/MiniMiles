import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { data: [], error: null, count: 0 } as {
    data: unknown[];
    error: { message: string } | null;
    count: number | null;
  },
  calls: [] as Array<{ method: string; args: unknown[] }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.calls.push({ method: "from", args: [table] });
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit", "or", "eq"]) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push({ method, args });
          return chain;
        };
      }
      chain.then = (resolve: (value: typeof state.result) => unknown) =>
        Promise.resolve(state.result).then(resolve);
      return chain;
    },
  }),
}));

const { getOwnedVoucherPreviews } = await import("@/lib/akiba/myVouchers");

describe("profile owned-voucher preview", () => {
  beforeEach(() => {
    state.calls = [];
    state.result = { data: [], error: null, count: 0 };
  });

  it("maps active owned vouchers and uses verified wallet ownership", async () => {
    state.result = {
      count: 3,
      error: null,
      data: [{
        id: "voucher-1",
        status: "issued",
        expires_at: "2026-11-20T00:00:00Z",
        rules_snapshot: null,
        spend_voucher_templates: {
          title: "Lunch reward",
          voucher_type: "percent_off",
          discount_percent: 20,
          discount_cusd: null,
          discount_kes: null,
          retail_value_cusd: null,
          partners: { name: "Coast Café", image_url: "https://cdn.example/coast.png" },
        },
      }],
    };

    await expect(getOwnedVoucherPreviews({
      userId: "user-1",
      walletAddresses: ["0xabc"],
      limit: 2,
    })).resolves.toEqual({
      totalCount: 3,
      items: [{
        id: "voucher-1",
        status: "issued",
        title: "Lunch reward",
        valueLabel: "20% off",
        merchantName: "Coast Café",
        merchantLogoUrl: "https://cdn.example/coast.png",
        expiresAt: "2026-11-20T00:00:00Z",
      }],
    });

    expect(state.calls).toContainEqual({
      method: "or",
      args: ["hub_user_id.eq.user-1,user_address.in.(0xabc)"],
    });
    expect(state.calls).toContainEqual({ method: "limit", args: [2] });
  });

  it("uses the immutable rules snapshot when the template join is unavailable", async () => {
    state.result = {
      count: 1,
      error: null,
      data: [{
        id: "voucher-2",
        status: "claiming",
        expires_at: null,
        rules_snapshot: {
          title: "Free coffee",
          voucher_type: "free",
          discount_percent: null,
          discount_cusd: null,
          retail_value_cusd: 5,
        },
        spend_voucher_templates: null,
      }],
    };

    const result = await getOwnedVoucherPreviews({ userId: "user-2", walletAddresses: [] });
    expect(result.items[0]).toMatchObject({
      title: "Free coffee",
      valueLabel: "Free (up to $5.00)",
      merchantName: "Akiba reward",
      merchantLogoUrl: null,
    });
    expect(state.calls).toContainEqual({ method: "eq", args: ["hub_user_id", "user-2"] });
  });

  it("fails closed to an empty preview when the query fails", async () => {
    state.result = { data: [], count: null, error: { message: "connection failed" } };
    await expect(getOwnedVoucherPreviews({ userId: "user-3", walletAddresses: [] }))
      .resolves.toEqual({ items: [], totalCount: 0 });
  });
});
