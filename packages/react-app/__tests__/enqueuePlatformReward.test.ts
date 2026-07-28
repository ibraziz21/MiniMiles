/**
 * Unit test for enqueuePlatformReward (discovery-quests-spec.md §5.4 reward
 * bridge) — the mint-queue insert the inbound reward-issued webhook route
 * calls. In its own file, separate from rewardIssuedBridge.test.ts, because
 * that file mocks "@/lib/minipointQueue" wholesale to test the route in
 * isolation — a mock hoisted to module-top for the whole file, which would
 * shadow the real implementation this test needs to exercise.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        mockInsert(row);
        return { select: () => ({ single: mockSingle }) };
      },
    }),
  },
}));

const { enqueuePlatformReward } = await import("@/lib/minipointQueue");

beforeEach(() => {
  mockInsert.mockClear();
  mockSingle.mockReset();
  mockSingle.mockResolvedValue({ data: { id: "job-1" }, error: null });
});

describe("enqueuePlatformReward", () => {
  it("inserts a mint job keyed by platform_reward:{rewardId}", async () => {
    await enqueuePlatformReward({
      rewardId: "reward-42",
      questId: "quest-9",
      walletAddress: "0xDEF",
      points: 25,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: "platform_reward:reward-42",
        user_address: "0xdef",
        points: 25,
        payload: expect.objectContaining({
          kind: "platform_reward",
          rewardId: "reward-42",
          questId: "quest-9",
          userAddress: "0xdef",
          pointsAwarded: 25,
        }),
      })
    );
  });
});
