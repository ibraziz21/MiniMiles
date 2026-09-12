import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockClaimQueuedDailyReward = vi.fn();
const mockIsSelfClaimEnabledForWallet = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
  logSessionAge: () => true,
}));

vi.mock("@/lib/minipointQueue", () => ({
  claimQueuedDailyReward: (...args: any[]) => mockClaimQueuedDailyReward(...args),
}));

vi.mock("@/lib/server/dailySelfClaimMode", () => ({
  isSelfClaimEnabledForWallet: (...args: any[]) => mockIsSelfClaimEnabledForWallet(...args),
}));

vi.mock("@/lib/questRegistry", () => ({
  getQuest: (key: string) => ({ questId: `quest-${key}`, points: 30, reason: `reason-${key}` }),
}));

vi.mock("@/helpers/graphQuestTransfer", () => ({
  userSentAtLeast1DollarIn24Hrs: async () => true,
  userReceivedAtLeast1DollarIn24Hrs: async () => true,
  countOutgoingTransfersIn24H: async () => 999,
}));

vi.mock("@/helpers/erc20Balance", () => ({
  userErc20BalanceAtLeast: async () => true,
}));

vi.mock("@/helpers/streaks", () => ({
  scopeKeyFor: () => "2026-09-12",
}));

type RouteCase = { family: string; path: string; extraEnv?: Record<string, string> };

const routes: RouteCase[] = [
  { family: "daily_transfer", path: "@/app/api/quests/daily_transfer/route" },
  { family: "daily_receive", path: "@/app/api/quests/daily_receive/route" },
  { family: "daily_5tx", path: "@/app/api/quests/daily_5_tx/route" },
  { family: "daily_10tx", path: "@/app/api/quests/daily_10_tx/route" },
  { family: "daily_20tx", path: "@/app/api/quests/daily_20_tx/route", extraEnv: { QUEST_ID_DAILY_20TX: "quest-daily_20tx" } },
  { family: "daily_kiln_hold", path: "@/app/api/quests/daily_kiln_hold/route" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xabc", issuedAt: Date.now() - 120_000 });
  mockClaimQueuedDailyReward.mockResolvedValue({
    ok: true,
    queued: true,
    txHash: undefined,
    points: 30,
    basePoints: 30,
    vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
  });
});

describe.each(routes)("POST /api/quests/$family — self-claim cutover gate", ({ family, path, extraEnv }) => {
  it("does not enqueue a mint job once this wallet is in self-claim mode for the family", async () => {
    if (extraEnv) Object.assign(process.env, extraEnv);
    mockIsSelfClaimEnabledForWallet.mockReturnValue(true);
    const { POST } = await import(path);

    const res = await POST(new Request("http://localhost/api/quests/x", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual(expect.objectContaining({ success: false, code: "self-claim-required" }));
    expect(mockClaimQueuedDailyReward).not.toHaveBeenCalled();
    expect(mockIsSelfClaimEnabledForWallet).toHaveBeenCalledWith(family, "0xabc");
  });

  it("keeps enqueueing normally for wallets not yet on self-claim", async () => {
    if (extraEnv) Object.assign(process.env, extraEnv);
    mockIsSelfClaimEnabledForWallet.mockReturnValue(false);
    const { POST } = await import(path);

    const res = await POST(new Request("http://localhost/api/quests/x", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockClaimQueuedDailyReward).toHaveBeenCalledTimes(1);
  });
});
