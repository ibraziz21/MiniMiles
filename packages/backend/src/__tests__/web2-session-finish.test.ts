/**
 * POST /games/web2/session/finish — economy dispatch
 * (skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md
 * §3.3-3.4, §10.1). Proves the server-controlled kill switch: with
 * SKILL_GAME_ECONOMY_VERSION unset (or "legacy") the route calls the
 * unchanged legacy RPC with a TS-computed reward amount; with it set to
 * "mastery-v1" the route calls the new atomic RPC with raw score/accepted
 * only — never a TS-computed Miles amount as authority — and maps its
 * richer response onto the finish body.
 *
 * Invokes the Express route handler directly (no HTTP server / supertest
 * dependency): Router#stack exposes each registered layer, so the
 * "/session/finish" POST handler can be pulled out and called with a
 * minimal req/res double.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockResult = { data: any; error: any };

function chain(result: MockResult) {
  const c: any = {
    select: () => c,
    eq: () => c,
    maybeSingle: () => Promise.resolve(result),
    update: () => c,
    insert: () => c,
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return c;
}

const mockRpc = vi.fn();
const mockFrom = vi.fn();

const SERVER_SESSION_ROW = {
  session_id: "sess-1",
  canonical_id: "canon-1",
  hub_user_id: "hub-user-1",
  game_type: "rule_tap",
  finalized: false,
};

const FINAL_RESULT = {
  score: 18,
  accepted: true,
  rewardMiles: 12, // legacy 6/9/12 value — must be ignored under mastery-v1
  rewardStable: 0,
  completed: true,
  elapsedMs: 19000,
  flags: [] as string[],
};

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  res.locals = { assertion: { canonicalId: "canon-1", hubUserId: "hub-user-1" } };
  return res;
}

async function loadFinishHandler(version: "legacy" | "mastery-v1" | undefined) {
  vi.resetModules();
  if (version) process.env.SKILL_GAME_ECONOMY_VERSION = version;
  else delete process.env.SKILL_GAME_ECONOMY_VERSION;

  vi.doMock("../supabaseClient", () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
  vi.doMock("../games/serverSessionStore", async () => {
    const actual = await vi.importActual<typeof import("../games/serverSessionStore")>("../games/serverSessionStore");
    return { ...actual, stateFromRow: (row: unknown) => row, ruleStateFromRow: (row: unknown) => row };
  });
  vi.doMock("../games/ruleTapServer", () => ({
    finalizeRuleTap: () => FINAL_RESULT,
    ruleTapRuleView: () => ({}),
    buildRuleTapSession: () => ({ rule: {}, timeline: [] }),
    revealedTiles: () => [],
    applyTap: () => ({ ok: false, reason: "unused" }),
    RULE_TAP_DURATION_MS: 20000,
    RULE_TAP_GRID_SIZE: 9,
    RULE_TAP_REVEAL_LEAD_MS: 250,
    RULE_TAP_TICK_MS: 500,
  }));
  vi.doMock("../games/memoryFlipServer", () => ({
    finalizeMemoryFlip: () => FINAL_RESULT,
    buildMemoryDeck: () => [],
    applyFlip: () => ({ ok: false, reason: "unused" }),
    newServerSeed: () => "seed",
    serverSeedHash: () => "hash",
    MEMORY_FLIP_CARD_COUNT: 16,
    MEMORY_FLIP_DURATION_MS: 60000,
  }));

  const { default: router } = await import("../games/web2Routes");
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === "/session/finish" && l.route.methods.post
  );
  if (!layer) throw new Error("finish route not found");
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("POST /games/web2/session/finish — economy dispatch", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: string) => {
      if (table === "skill_game_server_sessions") return chain({ data: SERVER_SESSION_ROW, error: null });
      return chain({ data: null, error: null });
    });
  });

  afterEach(() => {
    delete process.env.SKILL_GAME_ECONOMY_VERSION;
  });

  it('explicit SKILL_GAME_ECONOMY_VERSION="legacy" is the rollback lever — calls finalize_hub_skill_game_session with a computed reward', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "finalize_hub_skill_game_session") {
        return Promise.resolve({
          data: [{ accepted: true, score: 18, reward_miles: 12, reward_stable: 0, delivery_id: null }],
          error: null,
        });
      }
      if (fn === "hub_skill_game_play_status") {
        return Promise.resolve({ data: [{ plays_today: 1, plays_remaining: 4 }], error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const finish = await loadFinishHandler("legacy");
    const res = mockRes();
    await finish({ body: { sessionId: "sess-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "finalize_hub_skill_game_session",
      expect.objectContaining({ p_reward_miles: 12, p_reward_stable: 0 })
    );
    expect(mockRpc).not.toHaveBeenCalledWith("finalize_hub_skill_game_session_mastery_v1", expect.anything());
    expect(res.body.economyVersion).toBe("legacy");
    expect(res.body.rewardMiles).toBe(12);
    expect(res.body.tierAchieved).toBeNull();
    expect(res.body.rewardReason).toBeNull();
  });

  it("defaults to mastery-v1 when the env var is unset — calls the new atomic RPC with raw score/accepted only, no p_reward_miles", async () => {
    mockRpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "finalize_hub_skill_game_session_mastery_v1") {
        expect(args).not.toHaveProperty("p_reward_miles");
        expect(args).toMatchObject({ p_score: 18, p_accepted: true });
        return Promise.resolve({
          data: [
            {
              accepted: true,
              score: 18,
              economy_version: "mastery-v1",
              tier_achieved: "elite",
              previous_best_tier: "none",
              base_miles_delta: 3,
              campaign_bonus_delta: 0,
              cap_limited_miles: false,
              reward_reason: "new_tier",
              miles_credited_this_round: 3,
              game_miles_today: 3,
              game_miles_this_month: 3,
              delivery_id: "delivery-1",
              delivery_mode: "offchain_ledger",
              delivery_status: "completed",
              destination_wallet: null,
              already_finalized: false,
            },
          ],
          error: null,
        });
      }
      if (fn === "hub_skill_game_play_status") {
        return Promise.resolve({ data: [{ plays_today: 1, plays_remaining: 4 }], error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const finish = await loadFinishHandler(undefined);
    const res = mockRes();
    await finish({ body: { sessionId: "sess-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockRpc).not.toHaveBeenCalledWith("finalize_hub_skill_game_session", expect.anything());
    expect(res.body.economyVersion).toBe("mastery-v1");
    expect(res.body.rewardMiles).toBe(3); // NOT the legacy 12 baked into FINAL_RESULT
    expect(res.body.tierAchieved).toBe("elite");
    expect(res.body.previousBestTier).toBe("none");
    expect(res.body.milesCreditedThisRound).toBe(3);
    expect(res.body.gameMilesToday).toBe(3);
    expect(res.body.gameMilesThisMonth).toBe(3);
    expect(res.body.rewardReason).toBe("new_tier");
    expect(res.body.leaderboardEligible).toBe(true);
    expect(res.body.reward).toEqual({ mode: "offchain_ledger", status: "completed", deliveryId: "delivery-1" });
  });

  it("mastery-v1 zero-delta round still returns 200 with no delivery, but leaderboardEligible stays true", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "finalize_hub_skill_game_session_mastery_v1") {
        return Promise.resolve({
          data: [
            {
              accepted: true,
              score: 20,
              economy_version: "mastery-v1",
              tier_achieved: "elite",
              previous_best_tier: "elite",
              base_miles_delta: 0,
              campaign_bonus_delta: 0,
              cap_limited_miles: false,
              reward_reason: "tier_maintained",
              miles_credited_this_round: 0,
              game_miles_today: 3,
              game_miles_this_month: 30,
              delivery_id: null,
              delivery_mode: null,
              delivery_status: null,
              destination_wallet: null,
              already_finalized: false,
            },
          ],
          error: null,
        });
      }
      if (fn === "hub_skill_game_play_status") {
        return Promise.resolve({ data: [{ plays_today: 2, plays_remaining: 3 }], error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const finish = await loadFinishHandler("mastery-v1");
    const res = mockRes();
    await finish({ body: { sessionId: "sess-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.rewardMiles).toBe(0);
    expect(res.body.rewardReason).toBe("tier_maintained");
    expect(res.body.reward).toEqual({ mode: "none", status: "completed" });
    expect(res.body.leaderboardEligible).toBe(true);
  });
});
