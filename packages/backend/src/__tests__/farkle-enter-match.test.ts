/**
 * Backend unit tests for enterFarkleMatch.
 *
 * Proves:
 *   (a) Player A enters public queue → returns waiting; RPC is called without an invite code.
 *   (b) Player A creates an invite-only challenge → returns waiting with a generated invite code.
 *   (c) Player B joins with A's invite code → invite code resolves to A's address;
 *       RPC receives p_target_addr=A and returns matched.
 *   (d) Player A is already in queue (status="waiting") AND provides targetAddress=B →
 *       the early-return guard is skipped; RPC is called and returns matched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────

type MockResult = { data: any; error: any; count?: number | null };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = (): MockResult => (typeof result === "function" ? result() : result);
  const chain: any = {
    select:      () => chain,
    insert:      () => chain,
    update:      () => chain,
    upsert:      () => chain,
    delete:      () => chain,
    eq:          () => chain,
    neq:         () => chain,
    gt:          () => chain,
    lt:          () => chain,
    gte:         () => chain,
    in:          () => chain,
    is:          () => chain,
    not:         () => chain,
    or:          () => chain,
    order:       () => chain,
    limit:       () => chain,
    single:      () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then:        (fn: any) => Promise.resolve(resolve()).then(fn),
  };
  return chain;
}

const mockFrom = vi.fn();
const mockRpc  = vi.fn();

vi.mock("../supabaseClient", () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

// Mock settlement dependencies so we don't need chain/contract imports.
vi.mock("../farkle/settleOnChain", () => ({
  isFarkleMatchSettledOnChain: vi.fn(),
  readFarkleRewardCreditCents: vi.fn(),
  settleFarkleOnChain:         vi.fn(),
  simulateFarkleSettlement:    vi.fn(),
}));

vi.mock("../farkle/settlementJobs", () => ({
  countFarkleSettlementJobsByStatus: vi.fn(),
  getFarkleSettlementJob:            vi.fn(),
  getFarkleSettlementJobById:        vi.fn(),
  isMissingFarkleSettlementJobsTable: vi.fn(() => false),
  leaseFarkleSettlementJobs:         vi.fn(),
  listFarkleSettlementJobs:          vi.fn(),
  markFarkleJobConfirmed:            vi.fn(),
  markFarkleJobRetrying:             vi.fn(),
  upsertFarkleSettlementJob:         vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_MATCH_ID = "11111111-1111-1111-1111-111111111111";
const MODE_KEY = "FARKLE_QUICK_1500_AKIBA";

/**
 * Sets up mockFrom so that:
 *   - The invite code lookup (first matchmaking_queue call when inviteCode is set) returns
 *     `inviteSlot`.
 *   - All game_match_players calls return an empty array (no active matches → null).
 *   - The existing-queue call returns `existingQueue`.
 *   - All other matchmaking_queue calls (expire updates, etc.) return a no-op result.
 */
function setupMocks(opts: {
  hasInviteCode?: boolean;
  inviteSlot?: { wallet_address: string; mode_key: string } | null;
  existingQueue?: { status: string; match_id: string | null } | null;
}) {
  const mqCalls: MockResult[] = [];

  if (opts.hasInviteCode) {
    // 1st call: invite code lookup
    mqCalls.push({ data: opts.inviteSlot ?? null, error: null });
  }
  // expire waiting update
  mqCalls.push({ data: null, error: null });
  // expire matched update
  mqCalls.push({ data: null, error: null });
  // existing queue select (last matchmaking_queue call before RPC)
  mqCalls.push({ data: opts.existingQueue ?? null, error: null });

  let mqIdx = 0;

  mockFrom.mockImplementation((table: string) => {
    if (table === "game_match_players") {
      return makeChain({ data: [], error: null });
    }
    if (table === "matchmaking_queue") {
      const result = mqCalls[mqIdx] ?? { data: null, error: null };
      mqIdx++;
      return makeChain(result);
    }
    return makeChain({ data: null, error: null });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("enterFarkleMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // (a) Player A enters public queue and the RPC is called without an invite code.
  it("(a) returns waiting without invite code for public lobby when no opponent is found", async () => {
    setupMocks({ existingQueue: null });
    mockRpc.mockResolvedValue({ data: { status: "waiting" }, error: null });

    const { enterFarkleMatch } = await import("../farkle/service");
    const result = await enterFarkleMatch({ address: WALLET_A, modeKey: MODE_KEY });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ status: "waiting" });

    expect(mockRpc).toHaveBeenCalledOnce();
    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_caller).toBe(WALLET_A);
    expect(rpcArgs.p_invite_code).toBeNull();
    expect(rpcArgs.p_queue_scope).toBe("public");
    expect(rpcArgs.p_target_addr).toBeNull();
  });

  // (b) Player A creates a private invite slot and receives a code.
  it("(b) returns waiting with invite code for invite-only challenge", async () => {
    setupMocks({ existingQueue: null });
    mockRpc.mockResolvedValue({ data: { status: "waiting" }, error: null });

    const { enterFarkleMatch } = await import("../farkle/service");
    const result = await enterFarkleMatch({ address: WALLET_A, modeKey: MODE_KEY, queueType: "invite" });
    const body = result.body as any;

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe("waiting");
    expect(typeof body.inviteCode).toBe("string");
    expect(body.inviteCode.startsWith("FARK-")).toBe(true);

    expect(mockRpc).toHaveBeenCalledOnce();
    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof rpcArgs.p_invite_code).toBe("string");
    expect((rpcArgs.p_invite_code as string).startsWith("FARK-")).toBe(true);
    expect(rpcArgs.p_queue_scope).toBe("invite");
    expect(rpcArgs.p_target_addr).toBeNull();
  });

  // (b) Player B joins with A's invite code → match starts.
  it("(c) resolves invite code to A's address and returns matched", async () => {
    setupMocks({
      hasInviteCode: true,
      inviteSlot: { wallet_address: WALLET_A, mode_key: MODE_KEY },
      existingQueue: null,
    });
    mockRpc.mockResolvedValue({
      data: { status: "matched", match_id: TEST_MATCH_ID },
      error: null,
    });

    const { enterFarkleMatch } = await import("../farkle/service");
    const result = await enterFarkleMatch({
      address: WALLET_B,
      modeKey: MODE_KEY,
      inviteCode: "FARK-TEST",
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ status: "matched", matchId: TEST_MATCH_ID });

    expect(mockRpc).toHaveBeenCalledOnce();
    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    // Invite code was resolved to A's wallet and passed as the target.
    expect(rpcArgs.p_target_addr).toBe(WALLET_A);
    expect(rpcArgs.p_target_invite_code).toBe("FARK-TEST");
    expect(rpcArgs.p_queue_scope).toBe("public");
    expect(rpcArgs.p_invite_code).toBeNull();
    expect(rpcArgs.p_caller).toBe(WALLET_B);
  });

  // (c) A is already waiting; providing targetAddress must NOT trigger the early return.
  it("(d) skips 'already waiting' early-return when targetAddress is provided", async () => {
    // A already has status="waiting" in the queue.
    setupMocks({ existingQueue: { status: "waiting", match_id: null } });
    mockRpc.mockResolvedValue({
      data: { status: "matched", match_id: TEST_MATCH_ID },
      error: null,
    });

    const { enterFarkleMatch } = await import("../farkle/service");
    const result = await enterFarkleMatch({
      address: WALLET_A,
      modeKey: MODE_KEY,
      targetAddress: WALLET_B,
    });

    // Must not short-circuit to { status: "waiting" }.
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ status: "matched", matchId: TEST_MATCH_ID });

    // RPC must have been called with B as the target.
    expect(mockRpc).toHaveBeenCalledOnce();
    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_target_addr).toBe(WALLET_B);
  });

  // Regression: plain matchmaking with no target still short-circuits.
  it("returns waiting immediately when already in queue and no target provided", async () => {
    // A already waiting; no targetAddress/inviteCode → should return early without RPC.
    setupMocks({ existingQueue: { status: "waiting", match_id: null } });

    const { enterFarkleMatch } = await import("../farkle/service");
    const result = await enterFarkleMatch({ address: WALLET_A, modeKey: MODE_KEY });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ status: "waiting" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
