import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeGenericClaimNonce, deadlineForScope, getUtcDateKey } from "@/lib/dailyQuestClaimer";

const mockUserSent = vi.fn();
const mockUserReceived = vi.fn();
const mockCountOutgoing = vi.fn();
const mockErc20BalanceAtLeast = vi.fn();

vi.mock("@/helpers/graphQuestTransfer", () => ({
  userSentAtLeast1DollarIn24Hrs: (...a: any[]) => mockUserSent(...a),
  userReceivedAtLeast1DollarIn24Hrs: (...a: any[]) => mockUserReceived(...a),
  countOutgoingTransfersIn24H: (...a: any[]) => mockCountOutgoing(...a),
}));

vi.mock("@/helpers/erc20Balance", () => ({
  userErc20BalanceAtLeast: (...a: any[]) => mockErc20BalanceAtLeast(...a),
}));

vi.mock("@/lib/questRegistry", () => ({
  getQuest: (key: string) => {
    const table: Record<string, { questId: string; points: number; reason: string }> = {
      daily_transfer: { questId: "quest-transfer", points: 30, reason: "daily-transfer:quest-transfer" },
      daily_receive: { questId: "quest-receive", points: 30, reason: "daily-receive:quest-receive" },
      daily_5tx: { questId: "quest-5tx", points: 50, reason: "daily-5tx:quest-5tx" },
      daily_10tx: { questId: "quest-10tx", points: 60, reason: "daily-10tx:quest-10tx" },
      daily_20tx: { questId: "quest-20tx", points: 50, reason: "daily-20tx:quest-20tx" },
      daily_kiln_hold: { questId: "quest-kiln", points: 40, reason: "kiln-daily-hold" },
    };
    return table[key];
  },
}));

vi.mock("@/lib/server/legacyMintJobGuard", () => ({
  legacyDailyIdempotencyKey: (questId: string, addr: string, scope: string) =>
    `daily:${questId}:${addr.toLowerCase()}:${scope}`,
}));

const { dailyTransferAdapter } = await import("@/lib/server/adapters/dailyTransferAdapter");
const { dailyReceiveAdapter } = await import("@/lib/server/adapters/dailyReceiveAdapter");
const { daily5TxAdapter, daily10TxAdapter, daily20TxAdapter } = await import(
  "@/lib/server/adapters/dailyTransferCountAdapter"
);
const { dailyKilnHoldAdapter } = await import("@/lib/server/adapters/dailyKilnHoldAdapter");

const session = { walletAddress: "0xabc", issuedAt: Date.now() };

beforeEach(() => {
  vi.clearAllMocks();
  mockUserSent.mockResolvedValue(true);
  mockUserReceived.mockResolvedValue(true);
  mockCountOutgoing.mockResolvedValue(999);
  mockErc20BalanceAtLeast.mockResolvedValue(true);
});

describe("resolveIdentity — shared shape across every Phase-2 family", () => {
  it.each([
    ["dailyTransferAdapter", dailyTransferAdapter, "quest-transfer"],
    ["dailyReceiveAdapter", dailyReceiveAdapter, "quest-receive"],
    ["daily5TxAdapter", daily5TxAdapter, "quest-5tx"],
    ["daily10TxAdapter", daily10TxAdapter, "quest-10tx"],
    ["daily20TxAdapter", daily20TxAdapter, "quest-20tx"],
    ["dailyKilnHoldAdapter", dailyKilnHoldAdapter, "quest-kiln"],
  ])("%s uses today's UTC date as scope and the generic hashed nonce", async (_name, adapter, questId) => {
    const identity = await adapter.resolveIdentity(session);
    const today = getUtcDateKey();

    expect(identity.questId).toBe(questId);
    expect(identity.scopeKey).toBe(today);
    expect(identity.claimNonce).toBe(computeGenericClaimNonce(questId, today));
    expect(identity.deadline).toBe(deadlineForScope("daily", today));
  });

  it("gives two different families two different nonces for the same day", async () => {
    const a = await dailyTransferAdapter.resolveIdentity(session);
    const b = await dailyReceiveAdapter.resolveIdentity(session);
    expect(a.claimNonce).not.toBe(b.claimNonce);
  });
});

describe("dailyTransferAdapter.verifyEligibility", () => {
  it("rejects when there was no outgoing transfer ≥ $1 in 24h", async () => {
    mockUserSent.mockResolvedValue(false);
    const identity = await dailyTransferAdapter.resolveIdentity(session);
    const result = await dailyTransferAdapter.verifyEligibility(session, identity);
    expect(result.ok).toBe(false);
  });

  it("passes through basePoints and the daily_engagement finalizer when eligible", async () => {
    const identity = await dailyTransferAdapter.resolveIdentity(session);
    const result = await dailyTransferAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({ basePoints: 30, finalizerKind: "daily_engagement" }),
      }),
    );
  });
});

describe("dailyReceiveAdapter.verifyEligibility", () => {
  it("rejects when there was no incoming transfer ≥ $1 in 24h", async () => {
    mockUserReceived.mockResolvedValue(false);
    const identity = await dailyReceiveAdapter.resolveIdentity(session);
    const result = await dailyReceiveAdapter.verifyEligibility(session, identity);
    expect(result.ok).toBe(false);
  });
});

describe("transfer-count adapters (5/10/20)", () => {
  it("each enforces its own threshold", async () => {
    mockCountOutgoing.mockResolvedValue(7);
    const identity5 = await daily5TxAdapter.resolveIdentity(session);
    const identity10 = await daily10TxAdapter.resolveIdentity(session);

    const result5 = await daily5TxAdapter.verifyEligibility(session, identity5);
    const result10 = await daily10TxAdapter.verifyEligibility(session, identity10);

    expect(result5.ok).toBe(true); // 7 >= 5
    expect(result10.ok).toBe(false); // 7 < 10
    expect(mockCountOutgoing).toHaveBeenCalledWith("0xabc", 5);
    expect(mockCountOutgoing).toHaveBeenCalledWith("0xabc", 10);
  });

  it("fails closed (503) on an RPC error rather than silently passing", async () => {
    mockCountOutgoing.mockRejectedValue(new Error("RPC down"));
    const identity = await daily20TxAdapter.resolveIdentity(session);
    const result = await daily20TxAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 503 }));
  });
});

describe("dailyKilnHoldAdapter.verifyEligibility", () => {
  it("rejects with condition-failed when the balance is below the minimum", async () => {
    mockErc20BalanceAtLeast.mockResolvedValue(false);
    const identity = await dailyKilnHoldAdapter.resolveIdentity(session);
    const result = await dailyKilnHoldAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "condition-failed" }));
  });

  it("passes when the balance meets the minimum", async () => {
    const identity = await dailyKilnHoldAdapter.resolveIdentity(session);
    const result = await dailyKilnHoldAdapter.verifyEligibility(session, identity);
    expect(result.ok).toBe(true);
  });
});

describe("legacyIdempotencyKey — matches claimQueuedDailyReward's own format for every family", () => {
  it.each([
    [dailyTransferAdapter, "quest-transfer"],
    [dailyReceiveAdapter, "quest-receive"],
    [daily5TxAdapter, "quest-5tx"],
    [daily10TxAdapter, "quest-10tx"],
    [daily20TxAdapter, "quest-20tx"],
    [dailyKilnHoldAdapter, "quest-kiln"],
  ])("produces daily:{questId}:{wallet}:{scope}", async (adapter, questId) => {
    const identity = await adapter.resolveIdentity(session);
    const key = adapter.legacyIdempotencyKey!(identity, "0xABC");
    expect(key).toBe(`daily:${questId}:0xabc:${identity.scopeKey}`);
  });
});
