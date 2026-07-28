import { describe, expect, it } from "vitest";
import {
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
  QUEST_SPONSORED_LEADERBOARD,
} from "@/lib/merchantDiscoveryQuests";
import { summarizeMerchantQuestHealth } from "@/lib/server/merchantQuestHealth";

describe("merchant quest rollout health", () => {
  it("returns aggregate queue, proof, event, and campaign readiness", () => {
    const result = summarizeMerchantQuestHealth({
      now: new Date("2026-07-28T12:00:00.000Z"),
      jobs: [
        {
          status: "completed",
          payload: { questId: QUEST_AKIBA_PASS },
          updated_at: "2026-07-28T11:59:00.000Z",
        },
        {
          status: "pending",
          payload: { questId: QUEST_SPONSORED_LEADERBOARD },
          updated_at: "2026-07-28T11:59:00.000Z",
        },
        {
          status: "failed",
          payload: { questId: "unrelated-quest" },
          updated_at: "2026-07-28T11:59:00.000Z",
        },
      ],
      proofs: [
        { partner_quest_id: QUEST_AKIBA_PASS },
        { partner_quest_id: QUEST_BROWSE_DEALS },
        { partner_quest_id: "unrelated-quest" },
      ],
      events: [
        {
          event_type: "proof_recorded",
          partner_quest_id: QUEST_AKIBA_PASS,
        },
        {
          event_type: "reward_completed",
          partner_quest_id: QUEST_AKIBA_PASS,
        },
      ],
      activeCampaignGameTypes: ["tap-rush"],
      rollout: {
        enabled: true,
        percentage: 10,
        allowlistCount: 2,
      },
    });

    expect(result.healthy).toBe(true);
    expect(result.queue.total).toBe(2);
    expect(result.queue.byStatus).toEqual({
      pending: 1,
      processing: 0,
      completed: 1,
      failed: 0,
    });
    expect(result.proofs.total).toBe(2);
    expect(result.events.byType).toEqual({
      proof_recorded: 1,
      reward_completed: 1,
    });
    expect(result.sponsoredCampaign.configured).toBe(true);
    expect(result.rollout).toEqual({
      enabled: true,
      percentage: 10,
      allowlistCount: 2,
    });
    expect(result.warnings).toEqual([]);
  });

  it("warns on missing campaign, failed jobs, and stuck processing", () => {
    const result = summarizeMerchantQuestHealth({
      now: new Date("2026-07-28T12:00:00.000Z"),
      jobs: [
        {
          status: "failed",
          payload: { questId: QUEST_AKIBA_PASS },
          updated_at: "2026-07-28T11:59:00.000Z",
        },
        {
          status: "processing",
          payload: { questId: QUEST_BROWSE_DEALS },
          updated_at: "2026-07-28T11:40:00.000Z",
        },
      ],
      proofs: [],
      events: [],
      activeCampaignGameTypes: null,
      rollout: {
        enabled: false,
        percentage: 0,
        allowlistCount: 0,
      },
    });

    expect(result.healthy).toBe(false);
    expect(result.queue.stuckProcessing).toBe(1);
    expect(result.warnings).toEqual([
      "Merchant quest rollout master switch is disabled.",
      "No active sponsored-game campaign is configured.",
      "1 merchant quest reward job(s) failed.",
      "1 merchant quest reward job(s) have been processing for over 10 minutes.",
    ]);
  });
});
