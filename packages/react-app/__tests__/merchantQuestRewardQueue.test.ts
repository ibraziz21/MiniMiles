import { beforeEach, describe, expect, it, vi } from "vitest";
import { QUEST_SPONSORED_LEADERBOARD } from "@/lib/merchantDiscoveryQuests";

type DbResult = { data: any; error: any };
type DbCall = {
  table: string;
  method: string;
  args: unknown[];
};

const terminalResults = new Map<string, DbResult[]>();
const dbCalls: DbCall[] = [];

function nextResult(table: string): DbResult {
  const queue = terminalResults.get(table) ?? [];
  return queue.shift() ?? { data: null, error: null };
}

function makeChain(table: string) {
  const chain: any = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "eq",
    "limit",
  ]) {
    chain[method] = (...args: unknown[]) => {
      dbCalls.push({ table, method, args });
      return chain;
    };
  }
  chain.single = () => Promise.resolve(nextResult(table));
  chain.maybeSingle = () => Promise.resolve(nextResult(table));
  return chain;
}

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    from: (table: string) => makeChain(table),
  },
}));

describe("weekly merchant quest reward queue", () => {
  beforeEach(() => {
    terminalResults.clear();
    dbCalls.length = 0;
    terminalResults.set("partner_quest_weekly_claims", [
      { data: null, error: null },
    ]);
    terminalResults.set("vault_positions", [{ data: null, error: null }]);
  });

  it("reserves the week with an idempotent job and waits for the worker to complete it", async () => {
    terminalResults.set("minipoint_mint_jobs", [
      {
        data: {
          id: "job-1",
          status: "pending",
          idempotency_key: "weekly-key",
        },
        error: null,
      },
    ]);

    const { claimQueuedPartnerWeeklyReward } = await import(
      "@/lib/minipointQueue"
    );
    const result = await claimQueuedPartnerWeeklyReward({
      userAddress: "0xABC",
      questId: QUEST_SPONSORED_LEADERBOARD,
      points: 25,
      isoWeek: "2026-W31",
      reason: `partner-quest:${QUEST_SPONSORED_LEADERBOARD}`,
    });

    expect(result.ok).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({ jobId: "job-1", retried: false }),
    );
    expect(
      dbCalls.find(
        (call) =>
          call.table === "partner_quest_weekly_claims" &&
          call.method === "insert",
      ),
    ).toBeUndefined();
    expect(
      dbCalls.find(
        (call) =>
          call.table === "minipoint_mint_jobs" &&
          call.method === "insert",
      )?.args[0],
    ).toEqual(
      expect.objectContaining({
        idempotency_key: `partner-weekly:${QUEST_SPONSORED_LEADERBOARD}:0xabc:2026-W31`,
        payload: expect.objectContaining({
          kind: "partner_weekly_engagement",
          isoWeek: "2026-W31",
        }),
      }),
    );
  });

  it("revives a failed idempotent job when the user retries the reward", async () => {
    terminalResults.set("minipoint_mint_jobs", [
      { data: null, error: { code: "23505" } },
      {
        data: {
          id: "job-failed",
          status: "failed",
          idempotency_key: "weekly-key",
        },
        error: null,
      },
      {
        data: {
          id: "job-failed",
          status: "pending",
          idempotency_key: "weekly-key",
        },
        error: null,
      },
    ]);

    const { claimQueuedPartnerWeeklyReward } = await import(
      "@/lib/minipointQueue"
    );
    const result = await claimQueuedPartnerWeeklyReward({
      userAddress: "0xABC",
      questId: QUEST_SPONSORED_LEADERBOARD,
      points: 25,
      isoWeek: "2026-W31",
      reason: `partner-quest:${QUEST_SPONSORED_LEADERBOARD}`,
    });

    expect(result.ok).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({ jobId: "job-failed", retried: true }),
    );
    expect(
      dbCalls.find(
        (call) =>
          call.table === "minipoint_mint_jobs" &&
          call.method === "update",
      )?.args[0],
    ).toEqual(
      expect.objectContaining({
        status: "pending",
        attempts: 0,
        last_error: null,
      }),
    );
  });
});
