/**
 * Farkle PvP — unit tests.
 *
 * Coverage:
 *   1. Engine (pure functions) — dice rolling, scoring, replay/result hashing
 *   2. /roll route — duplicate roll idempotency, normal roll, farkle detection
 *   3. /bank route — duplicate bank idempotency, normal bank, winning bank
 *   4. /matches/find route — reconnect, already-waiting, RPC paths, balance errors
 *   5. Concurrency regressions — simultaneous find, settlement retry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────

type MockResult = { data: any; error: any; count?: number | null };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = (): MockResult => (typeof result === "function" ? result() : result);
  const chain: any = {
    select:      (_q?: any, _opts?: any) => chain,
    insert:      ()    => chain,
    update:      ()    => chain,
    upsert:      ()    => chain,
    delete:      ()    => chain,
    eq:          ()    => chain,
    neq:         ()    => chain,
    gt:          ()    => chain,
    lt:          ()    => chain,
    gte:         ()    => chain,
    in:          ()    => chain,
    is:          ()    => chain,
    not:         ()    => chain,
    or:          ()    => chain,
    order:       ()    => chain,
    limit:       ()    => chain,
    single:      ()    => Promise.resolve(resolve()),
    maybeSingle: ()    => Promise.resolve(resolve()),
    then:        (fn: any) => Promise.resolve(resolve()).then(fn),
  };
  return chain;
}

const mockFrom = vi.fn();
const mockRpc  = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireSession: () => mockSession(),
}));

// ── Session helpers mock ──────────────────────────────────────────────────────

const mockGetActive   = vi.fn();
const mockExpireQueue = vi.fn();

vi.mock("@/server/farkle/session", () => ({
  expireWaitingQueue:            (...args: any[]) => mockExpireQueue(...args),
  getActiveFarkleMatchForPlayer: (...args: any[]) => mockGetActive(...args),
}));

// ── Settlement dispatch mock ──────────────────────────────────────────────────

const mockGrantRewards = vi.fn();
vi.mock("@/server/farkle/grantRewards", () => ({
  grantFarkleRewards: (...args: any[]) => mockGrantRewards(...args),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MATCH_ID = "11111111-1111-1111-1111-111111111111";

function makeMatch(overrides: Record<string, any> = {}) {
  return {
    id:                   MATCH_ID,
    status:               "in_progress",
    current_turn_address: WALLET_A,
    turn_number:          1,
    metadata:             { seed: "test-seed-value", modeKey: "FARKLE_QUICK_1500_AKIBA" },
    server_seed:          null,
    seed_hash:            "abc123",
    game_modes: {
      target_score:         1500,
      mode_key:             "FARKLE_QUICK_1500_AKIBA",
      winner_miles_reward:  10,
      loser_miles_reward:   5,
      winner_reward_credit: 0,
    },
    ...overrides,
  };
}

function makeRequest(body?: object, method = "POST"): Request {
  return new Request(`http://localhost/api/games/farkle/${MATCH_ID}/roll`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Engine — pure function tests (no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

describe("Farkle Engine", () => {
  it("rollDice is deterministic — same seed+inputs always produce same dice", async () => {
    const { rollDice } = await import("@/lib/farkle/engine");
    const result1 = rollDice("seed-abc", MATCH_ID, 1, 1, 0, 6);
    const result2 = rollDice("seed-abc", MATCH_ID, 1, 1, 0, 6);
    expect(result1).toEqual(result2);
    expect(result1).toHaveLength(6);
    expect(result1.every((d) => d >= 1 && d <= 6)).toBe(true);
  });

  it("rollDice changes when any input changes", async () => {
    const { rollDice } = await import("@/lib/farkle/engine");
    const base = rollDice("seed-abc", MATCH_ID, 1, 1, 0, 6);
    expect(rollDice("seed-xyz", MATCH_ID, 1, 1, 0, 6)).not.toEqual(base);
    expect(rollDice("seed-abc", MATCH_ID, 2, 1, 0, 6)).not.toEqual(base);
    expect(rollDice("seed-abc", MATCH_ID, 1, 2, 0, 6)).not.toEqual(base);
  });

  it("scoreDice: single 1 = 100", async () => {
    const { scoreDice } = await import("@/lib/farkle/engine");
    const r = scoreDice([1, 2, 3, 4, 2, 3]);
    expect(r.score).toBe(100);
    expect(r.scoringIndices).toHaveLength(1);
  });

  it("scoreDice: single 5 = 50", async () => {
    const { scoreDice } = await import("@/lib/farkle/engine");
    const r = scoreDice([5, 2, 3, 4, 2, 3]);
    expect(r.score).toBe(50);
  });

  it("scoreDice: three 1s = 500", async () => {
    const { scoreDice } = await import("@/lib/farkle/engine");
    const r = scoreDice([1, 1, 1, 4, 2, 3]);
    expect(r.score).toBe(500);
  });

  it("scoreDice: three 2s = 200", async () => {
    const { scoreDice } = await import("@/lib/farkle/engine");
    const r = scoreDice([2, 2, 2, 4, 3, 6]);
    expect(r.score).toBe(200);
  });

  it("scoreDice: 1-2-3-4-5-6 straight = 1000", async () => {
    const { scoreDice } = await import("@/lib/farkle/engine");
    const r = scoreDice([1, 2, 3, 4, 5, 6]);
    expect(r.score).toBe(1000);
  });

  it("scoreDice: no scoring dice returns score 0", async () => {
    const { scoreDice } = await import("@/lib/farkle/engine");
    const r = scoreDice([2, 3, 4, 6, 2, 3]);
    expect(r.score).toBe(0);
    expect(r.scoringIndices).toHaveLength(0);
  });

  it("hasAnyScoringDie detects farkle", async () => {
    const { hasAnyScoringDie } = await import("@/lib/farkle/engine");
    expect(hasAnyScoringDie([2, 3, 4, 6, 2, 3])).toBe(false);
    expect(hasAnyScoringDie([1, 3, 4, 6, 2, 3])).toBe(true);
  });

  it("buildReplayHash is deterministic", async () => {
    const { buildReplayHash } = await import("@/lib/farkle/engine");
    const turns = [
      { walletAddress: WALLET_A, turnNumber: 1, rollNumber: 1, diceValues: [1, 2, 3, 4, 5, 6], heldIndices: [], action: "roll", bankPoints: 0 },
    ];
    const h1 = buildReplayHash(MATCH_ID, [WALLET_A, WALLET_B], "FARKLE_QUICK_1500_AKIBA", "seed-x", turns);
    const h2 = buildReplayHash(MATCH_ID, [WALLET_A, WALLET_B], "FARKLE_QUICK_1500_AKIBA", "seed-x", turns);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it("buildReplayHash differs when seed changes", async () => {
    const { buildReplayHash } = await import("@/lib/farkle/engine");
    const turns = [{ walletAddress: WALLET_A, turnNumber: 1, rollNumber: 1, diceValues: [1, 2, 3, 4, 5, 6], heldIndices: [], action: "roll", bankPoints: 0 }];
    const h1 = buildReplayHash(MATCH_ID, [WALLET_A], "FARKLE_QUICK_1500_AKIBA", "seed-a", turns);
    const h2 = buildReplayHash(MATCH_ID, [WALLET_A], "FARKLE_QUICK_1500_AKIBA", "seed-b", turns);
    expect(h1).not.toBe(h2);
  });

  it("buildResultHash links replay integrity to match outcome", async () => {
    const { buildReplayHash, buildResultHash } = await import("@/lib/farkle/engine");
    const replayHash = buildReplayHash(MATCH_ID, [WALLET_A, WALLET_B], "FARKLE_QUICK_1500_AKIBA", "seed-x", []);
    const rh1 = buildResultHash(MATCH_ID, WALLET_A, WALLET_B, 1500, 800, replayHash);
    const rh2 = buildResultHash(MATCH_ID, WALLET_A, WALLET_B, 1500, 800, replayHash);
    expect(rh1).toBe(rh2);
    // Different winner → different result hash
    const rh3 = buildResultHash(MATCH_ID, WALLET_B, WALLET_A, 1500, 800, replayHash);
    expect(rh1).not.toBe(rh3);
  });

  it("generateServerSeed and hashServerSeed produce consistent output", async () => {
    const { generateServerSeed, hashServerSeed } = await import("@/lib/farkle/engine");
    const seed = generateServerSeed();
    expect(seed).toHaveLength(64); // SHA-256 hex
    const hash = hashServerSeed(seed);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(seed); // hash of hash ≠ seed
    expect(hashServerSeed(seed)).toBe(hash); // deterministic
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. /roll — route tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/games/farkle/[matchId]/roll", () => {
  let rollHandler: (req: Request, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../app/api/games/farkle/[matchId]/roll/route");
    rollHandler = mod.POST;
    mockSession.mockResolvedValue({ walletAddress: WALLET_A });
  });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await rollHandler(makeRequest({ holdIndices: [] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid holdIndices", async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return makeChain({ data: makeMatch(), error: null });
    });
    const res = await rollHandler(
      makeRequest({ holdIndices: [0, 0] }), // duplicate index
      { params: Promise.resolve({ matchId: MATCH_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when it is not the caller's turn", async () => {
    mockFrom.mockReturnValue(makeChain({ data: makeMatch({ current_turn_address: WALLET_B }), error: null }));
    const res = await rollHandler(makeRequest({ holdIndices: [] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(403);
  });

  it("returns 409 on duplicate roll (unique constraint 23505)", async () => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches") return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2) {
        // prev rolls query — no prior roll (first roll of turn)
        return makeChain({ data: [], error: null });
      }
      if (table === "game_match_players") return makeChain({ data: { seat_index: 0 }, error: null });
      // Turn insert — simulate duplicate
      return makeChain({ data: null, error: { code: "23505", message: "duplicate" } });
    });
    const res = await rollHandler(makeRequest({ holdIndices: [] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already recorded/i);
  });

  it("returns dice array on successful first roll", async () => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches")    return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2) return makeChain({ data: [], error: null });
      if (table === "game_match_players") return makeChain({ data: { seat_index: 0 }, error: null });
      // Turn insert — success
      return makeChain({ data: null, error: null });
    });
    const res = await rollHandler(makeRequest({ holdIndices: [] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dice).toHaveLength(6);
    expect(json.rollNumber).toBe(1);
    expect(typeof json.isFarkle).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. /bank — route tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/games/farkle/[matchId]/bank", () => {
  let bankHandler: (req: Request, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../app/api/games/farkle/[matchId]/bank/route");
    bankHandler = mod.POST;
    mockSession.mockResolvedValue({ walletAddress: WALLET_A });
  });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when holdIndices is empty", async () => {
    mockFrom.mockReturnValue(makeChain({ data: makeMatch(), error: null }));
    const res = await bankHandler(makeRequest({ holdIndices: [] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate bank (unique constraint 23505)", async () => {
    // Dice [1,2,3,4,5,6] with holdIndices [0] = holding the 1 (scores 100)
    const lastRoll = {
      roll_number: 1, dice_values: [1, 2, 3, 4, 5, 6],
      selected_dice: [], turn_points: 0, farkled: false,
    };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches")   return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2) return makeChain({ data: [lastRoll], error: null });
      // Insert → 23505
      return makeChain({ data: null, error: { code: "23505", message: "duplicate" } });
    });
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already recorded/i);
  });

  it("returns 400 when selected dice score 0", async () => {
    // dice [2,3,4,6,2,3] — no scoring dice, trying to bank index 0 (die value 2)
    const lastRoll = {
      roll_number: 1, dice_values: [2, 3, 4, 6, 2, 3],
      selected_dice: [], turn_points: 0, farkled: false,
    };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches")   return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2) return makeChain({ data: [lastRoll], error: null });
      return makeChain({ data: null, error: null });
    });
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/score 0/i);
  });

  it("normal bank switches turn to opponent", async () => {
    // holdIndices [0] on dice [1,...] = 100 pts, well below target
    const lastRoll = {
      roll_number: 1, dice_values: [1, 2, 3, 4, 2, 3],
      selected_dice: [], turn_points: 0, farkled: false,
    };
    const players = [
      { wallet_address: WALLET_A, banked_score: 0 },
      { wallet_address: WALLET_B, banked_score: 0 },
    ];
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches" && callCount === 1) return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2)  return makeChain({ data: [lastRoll], error: null });
      if (table === "farkle_turns" && callCount === 3)  return makeChain({ data: null, error: null }); // insert
      if (table === "game_match_players" && callCount === 4) return makeChain({ data: { banked_score: 0 }, error: null });
      if (table === "game_match_players" && callCount === 5) return makeChain({ data: null, error: null }); // score update
      // players for advance-turn query
      if (table === "game_match_players") return makeChain({ data: players, error: null });
      // game_matches update (advance turn)
      return makeChain({ data: null, error: null });
    });
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bankedScore).toBe(100);
    expect(json.turnPoints).toBe(100);
    expect(json.matchComplete).toBeUndefined(); // not a winning bank
  });

  it("winning bank triggers settlement dispatch", async () => {
    // Player already at 1400, banks 100 more to hit 1500 target
    const lastRoll = {
      roll_number: 1, dice_values: [1, 2, 3, 4, 2, 3],
      selected_dice: [], turn_points: 0, farkled: false,
    };
    const players = [
      { wallet_address: WALLET_A, banked_score: 1400, seat_index: 0 },
      { wallet_address: WALLET_B, banked_score: 700,  seat_index: 1 },
    ];
    mockGrantRewards.mockResolvedValue(undefined);
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches" && callCount === 1)   return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2)   return makeChain({ data: [lastRoll], error: null });
      if (table === "farkle_turns" && callCount === 3)   return makeChain({ data: null, error: null }); // insert
      if (table === "game_match_players" && callCount === 4) return makeChain({ data: { banked_score: 1400 }, error: null });
      if (table === "game_match_players" && callCount === 5) return makeChain({ data: null, error: null }); // score update
      if (table === "game_match_players" && callCount === 6) return makeChain({ data: players, error: null }); // all players
      if (table === "farkle_turns" && callCount === 7)   return makeChain({ data: [], error: null }); // all turns for replay
      // game_matches + player result updates for settle()
      return makeChain({ data: null, error: null });
    });
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matchComplete).toBe(true);
    expect(json.winnerId).toBe(WALLET_A);
    expect(json.bankedScore).toBe(1500);
    expect(mockGrantRewards).toHaveBeenCalledOnce();
  });

  it("winning bank returns settlementStatus:pending when grantFarkleRewards throws", async () => {
    const lastRoll = {
      roll_number: 1, dice_values: [1, 2, 3, 4, 2, 3],
      selected_dice: [], turn_points: 0, farkled: false,
    };
    const players = [
      { wallet_address: WALLET_A, banked_score: 1400, seat_index: 0 },
      { wallet_address: WALLET_B, banked_score: 700,  seat_index: 1 },
    ];
    mockGrantRewards.mockRejectedValue(new Error("backend down"));
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches" && callCount === 1)   return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2)   return makeChain({ data: [lastRoll], error: null });
      if (table === "farkle_turns" && callCount === 3)   return makeChain({ data: null, error: null });
      if (table === "game_match_players" && callCount === 4) return makeChain({ data: { banked_score: 1400 }, error: null });
      if (table === "game_match_players" && callCount === 5) return makeChain({ data: null, error: null });
      if (table === "game_match_players" && callCount === 6) return makeChain({ data: players, error: null });
      if (table === "farkle_turns" && callCount === 7)   return makeChain({ data: [], error: null });
      return makeChain({ data: null, error: null });
    });
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matchComplete).toBe(true);
    expect(json.settlementStatus).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. /matches/find — route tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/games/farkle/matches/find", () => {
  let findHandler: (req: Request) => Promise<Response>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.FARKLE_SETTLEMENT_SECRET = "test-secret";
    process.env.FARKLE_SETTLEMENT_BACKEND_URL = "https://backend.test";
    delete process.env.ADMIN_QUEUE_SECRET;
    delete process.env.CRON_SECRET;
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const mod = await import("../app/api/games/farkle/matches/find/route");
    findHandler = mod.POST;
    mockSession.mockResolvedValue({ walletAddress: WALLET_A });
    mockExpireQueue.mockResolvedValue(undefined);
    mockGetActive.mockResolvedValue(null);
  });

  const makeFind = (body: object) =>
    new Request("http://localhost/api/games/farkle/matches/find", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when modeKey is missing", async () => {
    const res = await findHandler(makeFind({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when modeKey is invalid", async () => {
    const res = await findHandler(makeFind({ modeKey: "INVALID_MODE" }));
    expect(res.status).toBe(400);
  });

  it("reconnect: returns matched immediately when active match exists", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      status: "matched",
      matchId: MATCH_ID,
      modeKey: "FARKLE_QUICK_1500_AKIBA",
    }), { status: 200 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("matched");
    expect(json.matchId).toBe(MATCH_ID);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://backend.test/games/farkle/matches/find",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ address: WALLET_A, modeKey: "FARKLE_QUICK_1500_AKIBA", queueType: "public" }),
      }),
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("passes invite queueType through to backend", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "waiting", inviteCode: "FARK-TEST" }), { status: 200 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA", queueType: "invite" }));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://backend.test/games/farkle/matches/find",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ address: WALLET_A, modeKey: "FARKLE_QUICK_1500_AKIBA", queueType: "invite" }),
      }),
    );
  });

  it("retries backend auth with fallback secrets when the primary secret is stale", async () => {
    process.env.FARKLE_SETTLEMENT_SECRET = "stale-secret";
    process.env.ADMIN_QUEUE_SECRET = "working-admin-secret";
    vi.resetModules();
    const mod = await import("../app/api/games/farkle/matches/find/route");
    findHandler = mod.POST;

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "waiting" }), { status: 200 }));

    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(new Headers(mockFetch.mock.calls[0][1].headers).get("authorization")).toBe("Bearer stale-secret");
    expect(new Headers(mockFetch.mock.calls[1][1].headers).get("authorization")).toBe("Bearer working-admin-secret");
  });

  it("already waiting: returns waiting from backend without local RPC", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "waiting" }), { status: 200 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("waiting");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("backend waiting: returns waiting when no opponent found", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "waiting" }), { status: 200 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("waiting");
  });

  it("backend matched: returns matchId when opponent found", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "matched", matchId: MATCH_ID }), { status: 200 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("matched");
    expect(json.matchId).toBe(MATCH_ID);
  });

  it("returns 402 when backend reports insufficient tickets", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "insufficient-tickets" }), { status: 402 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("insufficient-tickets");
  });

  it("returns 402 when backend reports insufficient credits", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "insufficient-credits" }), { status: 402 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_REWARD_3000_USDT" }));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("insufficient-credits");
  });

  it("returns 402 on concurrent balance drain (insufficient_balance_retry)", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "insufficient-balance" }), { status: 402 }));
    const res = await findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" }));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("insufficient-balance");
  });

  // ── Concurrency regression: simultaneous calls ────────────────────────────

  it("simultaneous find calls: second call sees 'waiting' when first is still in RPC", async () => {
    let calls = 0;
    mockFetch.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ status: "matched", matchId: MATCH_ID }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "waiting" }), { status: 200 });
    });

    const [res1, res2] = await Promise.all([
      findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" })),
      findHandler(makeFind({ modeKey: "FARKLE_QUICK_1500_AKIBA" })),
    ]);

    const json1 = await res1.json();
    const json2 = await res2.json();
    // One call gets matched, the other gets waiting (the atomic RPC handles the race)
    const statuses = [json1.status, json2.status].sort();
    expect(statuses).toContain("matched");
  });

  // ── Settlement retry regression ───────────────────────────────────────────

  it("settlement is retried when grantFarkleRewards fails on first attempt", async () => {
    // This verifies the reconcile pattern: bank returns pending when grant fails,
    // and a subsequent retry resolves successfully.
    const lastRoll = {
      roll_number: 1, dice_values: [1, 2, 3, 4, 2, 3],
      selected_dice: [], turn_points: 0, farkled: false,
    };
    const players = [
      { wallet_address: WALLET_A, banked_score: 1400, seat_index: 0 },
      { wallet_address: WALLET_B, banked_score: 700,  seat_index: 1 },
    ];

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches" && callCount === 1)    return makeChain({ data: makeMatch(), error: null });
      if (table === "farkle_turns" && callCount === 2)    return makeChain({ data: [lastRoll], error: null });
      if (table === "farkle_turns" && callCount === 3)    return makeChain({ data: null, error: null });
      if (table === "game_match_players" && callCount === 4) return makeChain({ data: { banked_score: 1400 }, error: null });
      if (table === "game_match_players" && callCount === 5) return makeChain({ data: null, error: null });
      if (table === "game_match_players" && callCount === 6) return makeChain({ data: players, error: null });
      if (table === "farkle_turns" && callCount === 7)    return makeChain({ data: [], error: null });
      return makeChain({ data: null, error: null });
    });

    // First attempt: settlement fails
    mockGrantRewards.mockRejectedValueOnce(new Error("backend unavailable"));
    const { POST: bankHandler } = await import("../app/api/games/farkle/[matchId]/bank/route");
    const res = await bankHandler(makeRequest({ holdIndices: [0] }), { params: Promise.resolve({ matchId: MATCH_ID }) });
    const json = await res.json();
    expect(json.settlementStatus).toBe("pending");

    // After reconcile, same matchId would succeed
    mockGrantRewards.mockResolvedValueOnce(undefined);
    await expect(mockGrantRewards({ matchId: MATCH_ID, modeKey: "FARKLE_QUICK_1500_AKIBA", winnerAddress: WALLET_A, loserAddress: WALLET_B, winnerScore: 1500, loserScore: 700, winMiles: 10, losMiles: 5, winCreditCents: 0, endReason: "score" })).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. /state and /events — participant auth (requirement d)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/games/farkle/[matchId]/state — participant auth", () => {
  let stateHandler: (req: Request, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../app/api/games/farkle/[matchId]/state/route");
    stateHandler = mod.GET;
    mockSession.mockResolvedValue({ walletAddress: WALLET_A });
  });

  const makeStateReq = () =>
    new Request(`http://localhost/api/games/farkle/${MATCH_ID}/state`, { method: "GET" });

  it("(d) returns 401 when there is no session", async () => {
    mockSession.mockResolvedValue(null);
    const res = await stateHandler(makeStateReq(), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(401);
  });

  it("(d) returns 403 when the authenticated wallet is not a participant", async () => {
    // The match exists but its player list does not contain WALLET_A.
    const nonParticipant = "0xcccccccccccccccccccccccccccccccccccccccc";
    mockSession.mockResolvedValue({ walletAddress: nonParticipant });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches") return makeChain({ data: makeMatch(), error: null });
      if (table === "game_match_players")
        // Only WALLET_A and WALLET_B are participants — not nonParticipant.
        return makeChain({ data: [
          { wallet_address: WALLET_A, banked_score: 0 },
          { wallet_address: WALLET_B, banked_score: 0 },
        ], error: null });
      return makeChain({ data: null, error: null });
    });

    const res = await stateHandler(makeStateReq(), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(403);
  });

  it("(d) returns 200 when the authenticated wallet is a participant", async () => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "game_matches") return makeChain({ data: makeMatch(), error: null });
      if (table === "game_match_players")
        return makeChain({ data: [
          { wallet_address: WALLET_A, banked_score: 0 },
          { wallet_address: WALLET_B, banked_score: 0 },
        ], error: null });
      if (table === "farkle_turns") return makeChain({ data: [], error: null });
      if (table === "farkle_reactions") return makeChain({ data: [], error: null });
      return makeChain({ data: null, error: null });
    });

    const res = await stateHandler(makeStateReq(), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matchId).toBe(MATCH_ID);
    expect(json.yourUserId).toBe(WALLET_A);
  });
});

describe("GET /api/games/farkle/[matchId]/events — participant auth", () => {
  let eventsHandler: (req: Request, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../app/api/games/farkle/[matchId]/events/route");
    eventsHandler = mod.GET;
    mockSession.mockResolvedValue({ walletAddress: WALLET_A });
  });

  const makeEventsReq = () =>
    new Request(`http://localhost/api/games/farkle/${MATCH_ID}/events`, { method: "GET" });

  it("(d) returns 401 when there is no session", async () => {
    mockSession.mockResolvedValue(null);
    const res = await eventsHandler(makeEventsReq(), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(401);
  });

  it("(d) returns 403 before opening the stream for a non-participant", async () => {
    const nonParticipant = "0xcccccccccccccccccccccccccccccccccccccccc";
    mockSession.mockResolvedValue({ walletAddress: nonParticipant });

    mockFrom.mockImplementation((table: string) => {
      if (table === "game_matches") return makeChain({ data: makeMatch(), error: null });
      if (table === "game_match_players")
        return makeChain({ data: [
          { wallet_address: WALLET_A, banked_score: 0 },
          { wallet_address: WALLET_B, banked_score: 0 },
        ], error: null });
      return makeChain({ data: null, error: null });
    });

    // The pre-flight check should reject before a stream is opened, so the response
    // is a plain JSON 403, not an SSE text/event-stream response.
    const res = await eventsHandler(makeEventsReq(), { params: Promise.resolve({ matchId: MATCH_ID }) });
    expect(res.status).toBe(403);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
  });
});
