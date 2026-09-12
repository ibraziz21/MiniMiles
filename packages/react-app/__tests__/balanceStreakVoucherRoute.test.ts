import { beforeEach, describe, expect, it, vi } from "vitest";
import { BALANCE_STREAK_QUEST_IDS } from "@/lib/streakRegistry";

const mockIssueQuestVoucher = vi.fn();
vi.mock("@/lib/server/questClaimEngine", () => ({
  issueQuestVoucher: (...a: any[]) => mockIssueQuestVoucher(...a),
}));

// The adapters are imported for real (to assert identity via
// toHaveBeenCalledWith) — stub their transitive DB dependency so importing
// them doesn't try to construct a real Supabase client.
vi.mock("@/helpers/walletStableBalance", () => ({ userStableWalletBalanceAtLeastUsd: async () => true }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));

const { dailyBalanceStreak10Adapter, dailyBalanceStreak100Adapter } = await import(
  "@/lib/server/adapters/dailyBalanceStreakAdapter"
);
const { POST } = await import("@/app/api/streaks/balances/voucher/route");

function req(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueQuestVoucher.mockResolvedValue(Response.json({ success: true }));
});

describe("POST /api/streaks/balances/voucher", () => {
  it("selects the $10-tier adapter for the $10 questId", async () => {
    await POST(req({ questId: BALANCE_STREAK_QUEST_IDS["10"] }));
    expect(mockIssueQuestVoucher).toHaveBeenCalledWith(dailyBalanceStreak10Adapter, expect.any(Request));
  });

  it("selects the $100-tier adapter for the $100 questId — never a client-supplied tier", async () => {
    await POST(req({ questId: BALANCE_STREAK_QUEST_IDS["100"], tier: "10" }));
    expect(mockIssueQuestVoucher).toHaveBeenCalledWith(dailyBalanceStreak100Adapter, expect.any(Request));
  });

  it("returns 400 for an unregistered questId instead of guessing a tier", async () => {
    const res = await POST(req({ questId: "not-a-real-quest-id" }));
    expect(res.status).toBe(400);
    expect(mockIssueQuestVoucher).not.toHaveBeenCalled();
  });

  it("returns 400 when no questId is supplied", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockIssueQuestVoucher).not.toHaveBeenCalled();
  });
});
