import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  deliveries: new Map<string, any>(),
  wallets: [] as string[],
}));

vi.mock("@/lib/akiba/myVouchers", () => ({
  getLinkedWalletAddresses: async () => state.wallets,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => { throw new Error("legacy DB should not be queried without wallets"); },
}));
vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  resolveHubQuestCanonical: async () => "canonical-1",
  getCanonicalHubDeliveries: async () => state.deliveries,
  verifyHubQuestEvidence: async ({ quest }: any) => ({
    eligible: quest.key !== "voucher_redeemed",
    proofRef: `proof:${quest.key}`,
    reason: quest.key === "voucher_redeemed" ? "no-redeemed-voucher" : undefined,
  }),
}));

describe("Hub canonical quest status", () => {
  beforeEach(() => {
    state.wallets = [];
    state.deliveries = new Map();
  });

  it("shows a walletless Hub ledger completion as completed", async () => {
    state.deliveries.set("pass_activated", {
      completionId: "completion-1",
      deliveryId: "delivery-1",
      questKey: "pass_activated",
      scopeKey: "lifetime",
      status: "completed",
      mode: "offchain_ledger",
      awardedPoints: 20,
      externalRef: "ledger-1",
    });
    const { getHubQuestStatuses } = await import("@/lib/akiba/questStatus");
    const statuses = await getHubQuestStatuses({ hubUserId: "hub-user-1", email: "member@example.com" });
    expect(statuses.find((quest) => quest.key === "pass_activated")).toEqual(
      expect.objectContaining({ state: "completed", deliveryMode: "offchain_ledger", awardedPoints: 20 }),
    );
  });

  it("keeps non-wallet evidence eligible, including the sponsored game (walletless-pass-skill-games-spec.md §13)", async () => {
    const { getHubQuestStatuses } = await import("@/lib/akiba/questStatus");
    const statuses = await getHubQuestStatuses({ hubUserId: "hub-user-1", email: "member@example.com" });
    expect(statuses.find((quest) => quest.key === "profile_country_set")?.state).toBe("eligible");
    // §13 — sponsored_game_played no longer requires a wallet: a walletless
    // canonical session is sufficient evidence, so a walletless member sees
    // "eligible" here rather than "wallet_required".
    expect(statuses.find((quest) => quest.key === "sponsored_game_played")?.state).toBe("eligible");
    expect(statuses.find((quest) => quest.key === "voucher_redeemed")?.state).toBe("needs_action");
  });
});
