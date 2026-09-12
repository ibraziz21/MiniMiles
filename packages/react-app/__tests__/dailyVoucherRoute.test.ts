import { describe, expect, it, vi } from "vitest";

// The route is now a thin wrapper over the generic engine
// (docs/all-quests-self-claim-spec.md §5.1/§8.1) — the actual issuance-order
// logic is covered by questClaimEngine.test.ts (engine, with a fake adapter)
// and dailyCheckinAdapter.test.ts (this family's eligibility rules). This
// test only proves the route wires the right adapter into the engine.

const mockIssueQuestVoucher = vi.fn();
vi.mock("@/lib/server/questClaimEngine", () => ({
  issueQuestVoucher: (...a: any[]) => mockIssueQuestVoucher(...a),
}));

// dailyCheckinAdapter itself is imported for real (to assert identity via
// toHaveBeenCalledWith) — stub its transitive DB/RPC dependencies so
// importing it doesn't try to construct a real Supabase client.
vi.mock("@/lib/blacklist", () => ({ isBlacklisted: async () => false }));
vi.mock("@/lib/celoClient", () => ({ getCeloTxCount: async () => 100 }));
vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-daily", points: 10, reason: "daily-engagement:quest-daily" }),
}));
vi.mock("@/lib/server/legacyMintJobGuard", () => ({
  legacyDailyIdempotencyKey: (questId: string, addr: string, scope: string) => `daily:${questId}:${addr}:${scope}`,
}));

const { dailyCheckinAdapter } = await import("@/lib/server/adapters/dailyCheckinAdapter");
const { POST } = await import("@/app/api/quests/daily/voucher/route");

describe("POST /api/quests/daily/voucher", () => {
  it("delegates to the generic engine with the daily_checkin adapter", async () => {
    mockIssueQuestVoucher.mockResolvedValue(new Response(null, { status: 200 }));
    const request = new Request("http://localhost/api/quests/daily/voucher", { method: "POST" });

    await POST(request);

    expect(mockIssueQuestVoucher).toHaveBeenCalledWith(dailyCheckinAdapter, request);
  });

  it("returns whatever the engine returns, unmodified", async () => {
    const engineResponse = Response.json({ success: true }, { status: 200 });
    mockIssueQuestVoucher.mockResolvedValue(engineResponse);
    const res = await POST(new Request("http://localhost/api/quests/daily/voucher", { method: "POST" }));
    expect(res).toBe(engineResponse);
  });
});
