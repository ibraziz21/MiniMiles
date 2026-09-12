import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockIsSelfClaimEnabledForWallet = vi.fn();
const mockClaimQueuedDailyReward = vi.fn();
const mockBuildStatus = vi.fn();

vi.mock("@/lib/auth", () => ({ requireSession: () => mockRequireSession() }));
vi.mock("@/lib/server/dailySelfClaimMode", () => ({
  isSelfClaimEnabledForWallet: (...a: any[]) => mockIsSelfClaimEnabledForWallet(...a),
}));
vi.mock("@/lib/minipointQueue", () => ({
  claimQueuedDailyReward: (...a: any[]) => mockClaimQueuedDailyReward(...a),
}));
vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));
vi.mock("@/lib/sevenDaySendStreak", () => ({
  buildSevenDaySendStreakStatus: (...a: any[]) => mockBuildStatus(...a),
  SEVEN_DAY_STREAK_QUEST_ID: "6ddc811a-1a4d-4e57-871d-836f07486531",
}));

const { POST } = await import("@/app/api/quests/seven_day_streak/route");
const SEVEN_DAY_STREAK_QUEST_ID = "6ddc811a-1a4d-4e57-871d-836f07486531";

function req(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() });
  mockIsSelfClaimEnabledForWallet.mockReturnValue(false);
  mockBuildStatus.mockResolvedValue({ rewardClaimed: false, claimable: true, currentStreak: 7, progress: 7, daysLeft: 0 });
  mockClaimQueuedDailyReward.mockResolvedValue({ ok: true, points: 200, queued: true });
});

describe("POST /api/quests/seven_day_streak — self-claim cutover gate", () => {
  it("does not enqueue a mint job once this family is in self-claim mode", async () => {
    mockIsSelfClaimEnabledForWallet.mockReturnValue(true);
    const res = await POST(req({ questId: SEVEN_DAY_STREAK_QUEST_ID }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("self-claim-required");
    expect(mockClaimQueuedDailyReward).not.toHaveBeenCalled();
    expect(mockIsSelfClaimEnabledForWallet).toHaveBeenCalledWith("seven_day_send_streak", "0xabc");
  });

  it("keeps enqueueing normally while self-claim is off for this family", async () => {
    const res = await POST(req({ questId: SEVEN_DAY_STREAK_QUEST_ID }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockClaimQueuedDailyReward).toHaveBeenCalledTimes(1);
  });
});
