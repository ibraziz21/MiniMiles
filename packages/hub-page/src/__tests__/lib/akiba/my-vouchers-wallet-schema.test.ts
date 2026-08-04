import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { data: null, error: null } as { data: Array<{ address: string }> | null; error: unknown },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(state.result),
        then: (resolve: (value: typeof state.result) => unknown) =>
          Promise.resolve(state.result).then(resolve),
      };
      return chain;
    },
  }),
}));

describe("verified Hub wallet schema compatibility", () => {
  beforeEach(() => {
    state.result = { data: null, error: null };
  });

  it("treats a pre-verification-schema user as walletless", async () => {
    state.result = {
      data: null,
      error: {
        code: "42703",
        message: "column hub_user_wallets.verification_status does not exist",
      },
    };

    const { getLinkedWalletAddresses } = await import("@/lib/akiba/myVouchers");
    await expect(getLinkedWalletAddresses("hub-user-1")).resolves.toEqual([]);

    const { primaryVerifiedWallet } = await import("@/lib/akiba/canonicalPartnerQuests");
    await expect(primaryVerifiedWallet("hub-user-1")).resolves.toBeNull();
  });

  it("does not hide unrelated database failures", async () => {
    const error = { code: "08006", message: "connection failure" };
    state.result = { data: null, error };

    const { getLinkedWalletAddresses } = await import("@/lib/akiba/myVouchers");
    await expect(getLinkedWalletAddresses("hub-user-1")).rejects.toBe(error);
  });

  it("returns only the addresses selected by the verified-wallet query", async () => {
    state.result = { data: [{ address: "0xABCDEF" }], error: null };

    const { getLinkedWalletAddresses } = await import("@/lib/akiba/myVouchers");
    await expect(getLinkedWalletAddresses("hub-user-1")).resolves.toEqual(["0xabcdef"]);
  });
});
