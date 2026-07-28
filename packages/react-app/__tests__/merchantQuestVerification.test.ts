import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MERCHANT_DISCOVERY_QUEST_IDS,
  QUEST_AKIBA_PASS,
  QUEST_SPONSORED_LEADERBOARD,
} from "@/lib/merchantDiscoveryQuests";

type QueryResult = { data: any; error: any };

const tableResults = new Map<string, QueryResult>();
const queryCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

function makeChain(table: string) {
  const chain: any = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "gte",
    "gt",
    "lte",
    "lt",
    "limit",
  ]) {
    chain[method] = (...args: unknown[]) => {
      queryCalls.push({ table, method, args });
      return chain;
    };
  }
  chain.maybeSingle = () =>
    Promise.resolve(tableResults.get(table) ?? { data: null, error: null });
  chain.then = (resolve: (result: QueryResult) => unknown) =>
    Promise.resolve(
      tableResults.get(table) ?? { data: null, error: null },
    ).then(resolve);
  return chain;
}

const mockFrom = vi.fn((table: string) => makeChain(table));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

describe("merchant quest verification", () => {
  beforeEach(() => {
    tableResults.clear();
    queryCalls.length = 0;
    mockFrom.mockClear();
  });

  it("requires an accepted session from the active campaign game types", async () => {
    tableResults.set("game_weekly_campaigns", {
      data: { game_types: ["memory_flip"] },
      error: null,
    });
    tableResults.set("skill_game_sessions", {
      data: { session_id: "session-1" },
      error: null,
    });

    const { verifyMerchantQuestAction } = await import(
      "@/lib/server/merchantQuestVerification"
    );
    const result = await verifyMerchantQuestAction(
      QUEST_SPONSORED_LEADERBOARD,
      "0xABC",
    );

    expect(result).toEqual({ eligible: true });
    expect(queryCalls).toContainEqual({
      table: "skill_game_sessions",
      method: "in",
      args: ["game_type", ["memory_flip"]],
    });
  });

  it("fails closed when no sponsored campaign is active", async () => {
    tableResults.set("game_weekly_campaigns", { data: null, error: null });
    const { verifyMerchantQuestAction } = await import(
      "@/lib/server/merchantQuestVerification"
    );

    await expect(
      verifyMerchantQuestAction(QUEST_SPONSORED_LEADERBOARD, "0xabc"),
    ).resolves.toEqual({
      eligible: false,
      reason: "no-active-sponsored-campaign",
    });
    expect(mockFrom).not.toHaveBeenCalledWith("skill_game_sessions");
  });

  it("keeps a queued reward out of completed even when a claim row exists", async () => {
    const { resolveMerchantQuestStatus } = await import(
      "@/lib/server/merchantQuestVerification"
    );

    expect(
      resolveMerchantQuestStatus({
        questId: QUEST_AKIBA_PASS,
        jobState: "pending",
        completed: true,
        verification: { eligible: true },
      }),
    ).toEqual({ questId: QUEST_AKIBA_PASS, state: "queued" });
  });

  it("returns a server-derived status for every merchant quest", async () => {
    tableResults.set("partner_engagements", { data: [], error: null });
    tableResults.set("partner_quest_weekly_claims", {
      data: null,
      error: null,
    });
    tableResults.set("minipoint_mint_jobs", { data: [], error: null });
    tableResults.set("merchant_quest_action_proofs", {
      data: null,
      error: null,
    });
    tableResults.set("game_weekly_campaigns", {
      data: { game_types: ["rule_tap"] },
      error: null,
    });
    tableResults.set("skill_game_sessions", { data: null, error: null });
    tableResults.set("users", { data: null, error: null });
    tableResults.set("issued_vouchers", { data: null, error: null });

    const { getMerchantQuestStatuses } = await import(
      "@/lib/server/merchantQuestVerification"
    );
    const statuses = await getMerchantQuestStatuses("0xabc");

    expect(statuses.map((status) => status.questId)).toEqual([
      ...MERCHANT_DISCOVERY_QUEST_IDS,
    ]);
    expect(statuses).toHaveLength(5);
  });
});
