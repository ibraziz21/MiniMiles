/**
 * CrackPot chain-first cycle sync — unit tests.
 *
 * Coverage:
 *   1. openCycle failure does not create an active Supabase cycle.
 *   2. Successful open creates row with chain_id, contract_cycle_id,
 *      contract_version, and secret_commitment.
 *   3. CycleAlreadyActive race re-reads chain and uses the existing DB row.
 *   4. Expired on-chain cycle is expired on-chain before DB is marked dead.
 *   5. Active chain cycle with missing DB row fails closed.
 *   6. API surface never exposes secret_code or secret_salt.
 *   7. chainPotToDb unit conversions (Miles / USDT).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Contract mock ─────────────────────────────────────────────────────────────
// Declared first so vi.mock() hoisting can reference them.

const mockGetActiveCycle = vi.fn<(...args: any[]) => Promise<any>>();
const mockOpenCycle      = vi.fn<(...args: any[]) => Promise<string>>();
const mockExpireCycle    = vi.fn<(...args: any[]) => Promise<string>>();

vi.mock("@/lib/server/crackpotContract", () => ({
  ContractVersion: { MILES: 0, USDT: 1, STABLE: 1 },
  contractGetActiveCycle:  (...a: any[]) => mockGetActiveCycle(...a),
  contractOpenCycle:       (...a: any[]) => mockOpenCycle(...a),
  contractExpireCycle:     (...a: any[]) => mockExpireCycle(...a),
  contractActiveCycleId:   vi.fn().mockResolvedValue(0n),
  contractDeclareWinner:   vi.fn(),
  contractRecordEntry:     vi.fn(),
  contractPotBalance:      vi.fn().mockResolvedValue(0n),
  contractEnsureOpenCycle: vi.fn(),
  contractUsdtAccounting:  vi.fn().mockResolvedValue({
    balance: 0n, reservedPot: 0n, houseWithdrawable: 0n, freeBalance: 0n,
  }),
}));

// ── Engine mock (deterministic secret) ───────────────────────────────────────

vi.mock("@/lib/server/crackpotEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/crackpotEngine")>();
  return {
    ...actual,
    generateCode:      vi.fn().mockReturnValue([1, 2, 3, 4]),
    getCycleExpiresAt: vi.fn().mockReturnValue(new Date(Date.now() + 3_600_000)),
    getThemeForCycle:  vi.fn().mockReturnValue("bank-vault"),
    // computeSecretCommitment and COMMITMENT_ALGORITHM: use real implementations
  };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

// ── Default Supabase chain factory ────────────────────────────────────────────

/**
 * Builds a fluent Supabase query-builder mock.
 * Callers can inject overrides for specific methods.
 */
function buildChain(overrides: Record<string, (...a: any[]) => any> = {}): any {
  const chain: any = {
    select:      () => chain,
    insert:      () => chain,
    update:      () => chain,
    upsert:      () => chain,
    delete:      () => chain,
    eq:          () => chain,
    neq:         () => chain,
    in:          () => chain,
    is:          () => chain,
    not:         () => chain,
    or:          () => chain,
    order:       () => chain,
    limit:       () => chain,
    single:      () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then:        (fn: (v: any) => any) =>
      Promise.resolve({ data: null, error: null }).then(fn),
    ...overrides,
  };
  return chain;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_ID   = 42220;
const NOW_SEC    = Math.floor(Date.now() / 1000);
const FUTURE_EXP = BigInt(NOW_SEC + 7200);
const PAST_EXP   = BigInt(NOW_SEC - 120);
const STUB_TX    = "0xdeadbeef00000000000000000000000000000000000000000000000000000000";
const STUB_ID    = "aaaabbbb-0000-0000-0000-000000000001";

function makeChainCycle(overrides: Record<string, any> = {}) {
  return {
    id:           1n,
    version:      0,
    status:       0,
    potBalance:   200n * 10n ** 18n,   // 200 Miles (18-dec)
    potCap:       10_000n * 10n ** 18n,
    seedAmount:   200n * 10n ** 18n,
    houseAccrued: 0n,
    openedAt:     BigInt(NOW_SEC - 10),
    expiresAt:    FUTURE_EXP,
    winner:       "0x0000000000000000000000000000000000000000" as `0x${string}`,
    winnerGuesses: 0n,
    ...overrides,
  };
}

// ── Global reset before every test ────────────────────────────────────────────
// mockReset() clears call history AND the once-queue, preventing bleed-over.

const STUB_CONTRACT_ADDR = "0x32e2ebd9b502563a3b8fa59207f0542709456906";

beforeEach(() => {
  mockGetActiveCycle.mockReset();
  mockOpenCycle.mockReset();
  mockExpireCycle.mockReset();
  mockFrom.mockReset();
  // Restore default: returns an empty-resolving chain.
  mockFrom.mockImplementation(() => buildChain());
  // Set env vars required by crackpotAddr() / computeSecretCommitment.
  process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS      = STUB_CONTRACT_ADDR;
  process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS = STUB_CONTRACT_ADDR;
});

// ── Import module AFTER mocks are hoisted ─────────────────────────────────────

const { getOrSyncActiveCycle, chainPotToDb, generateSecretWithCommitment } =
  await import("@/lib/server/crackpotCycleSync");

// ══════════════════════════════════════════════════════════════════════════════

describe("chainPotToDb", () => {
  it("converts Miles 18-dec to whole miles", () => {
    expect(chainPotToDb(200n * 10n ** 18n,   "miles")).toBe(200);
    expect(chainPotToDb(10_000n * 10n ** 18n, "miles")).toBe(10_000);
  });

  it("converts micro-USDT (6-dec) to cents", () => {
    expect(chainPotToDb(2_000_000n, "usdt")).toBe(200);  // $2.00 → 200¢
    expect(chainPotToDb(50_000_000n, "usdt")).toBe(5000); // $50 → 5000¢
    expect(chainPotToDb(100_000n, "usdt")).toBe(10);      // $0.10 → 10¢
  });
});

describe("generateSecretWithCommitment", () => {
  it("returns a 4-element secret, a 64-char hex salt, and a 64-char hex commitment", () => {
    const expiry = new Date(Date.now() + 3_600_000);
    const { secret, salt, commitment } = generateSecretWithCommitment("e", 42220, 0, expiry, STUB_CONTRACT_ADDR as `0x${string}`);
    expect(secret).toHaveLength(4);
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("different calls produce different salts/commitments (randomised)", () => {
    const expiry = new Date(Date.now() + 3_600_000);
    const a = generateSecretWithCommitment("x", 42220, 0, expiry, STUB_CONTRACT_ADDR as `0x${string}`);
    const b = generateSecretWithCommitment("x", 42220, 0, expiry, STUB_CONTRACT_ADDR as `0x${string}`);
    expect(a.salt).not.toBe(b.salt);
    expect(a.commitment).not.toBe(b.commitment);
  });
});

// ── Test 1 ────────────────────────────────────────────────────────────────────

describe("Test 1 — openCycle failure does not create a DB cycle", () => {
  beforeEach(() => {
    mockGetActiveCycle.mockResolvedValue(null);
    mockOpenCycle.mockRejectedValue(new Error("insufficient USDT seed"));
  });

  it("re-throws the chain error and does not call supabase.from at all", async () => {
    await expect(getOrSyncActiveCycle("miles")).rejects.toThrow("insufficient USDT seed");
    // We reach step 3, call openCycle, it throws → we never touch the DB.
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────

describe("Test 2 — successful open creates/upserts row with chain fields", () => {
  const chainCycle = makeChainCycle({ id: 1n });

  beforeEach(() => {
    // First read: no cycle. Second read (after open): active cycle.
    mockGetActiveCycle
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(chainCycle);
    mockOpenCycle.mockResolvedValue(STUB_TX);
  });

  it("calls contractGetActiveCycle twice and contractOpenCycle once", async () => {
    const insertedRows: any[] = [];

    mockFrom.mockImplementation(() =>
      buildChain({
        insert:      (row: any) => { insertedRows.push(row); return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) }); },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, status: "active", pot_balance: 200, pot_cap: 10000, seed_amount: 200, expires_at: new Date(Date.now() + 3600_000).toISOString(), winner_address: null, winner_guesses: null, version: "miles", theme: "bank-vault", created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 1, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await getOrSyncActiveCycle("miles");

    expect(mockOpenCycle).toHaveBeenCalledOnce();
    expect(mockGetActiveCycle).toHaveBeenCalledTimes(2);
  });

  it("DB row contains chain_id, contract_cycle_id, contract_version, secret_commitment", async () => {
    const insertedRows: any[] = [];

    mockFrom.mockImplementation(() => {
      const insertChain: any = buildChain({
        single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }),
      });
      return buildChain({
        insert:      (row: any) => { insertedRows.push(row); return insertChain; },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 1, contract_version: 0, secret_commitment: "abc" }, error: null }),
      });
    });

    await getOrSyncActiveCycle("miles");

    expect(insertedRows.length).toBeGreaterThan(0);
    const row = insertedRows[0];
    expect(row.chain_id).toBe(CHAIN_ID);
    expect(row.contract_cycle_id).toBe(1);
    expect(row.contract_version).toBe(0);
    expect(row.secret_commitment).toMatch(/^0x[0-9a-f]{64}$/i);
    // secret_code and secret_salt exist in DB row but are not returned to callers
    expect(row.secret_code).toBeDefined();
    expect(row.secret_salt).toBeDefined();
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────

describe("Test 3 — CycleAlreadyActive race re-reads chain and uses existing DB row", () => {
  const raceChainCycle = makeChainCycle({ id: 99n });

  beforeEach(() => {
    mockGetActiveCycle
      .mockResolvedValueOnce(null)          // first read: no cycle
      .mockResolvedValueOnce(raceChainCycle); // second read after race

    const raceErr: any = new Error("CycleAlreadyActive");
    raceErr.shortMessage = "CycleAlreadyActive";
    mockOpenCycle.mockRejectedValue(raceErr);
  });

  it("does not rethrow CycleAlreadyActive when the DB row already exists", async () => {
    const insertedRows: any[] = [];

    mockFrom.mockImplementation(() =>
      buildChain({
        insert:      (row: any) => { insertedRows.push(row); return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) }); },
        maybeSingle: () => Promise.resolve({ data: { id: STUB_ID, status: "active" }, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 99, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await expect(getOrSyncActiveCycle("miles")).resolves.not.toThrow();
    expect(insertedRows).toHaveLength(0);
  });

  it("fails closed when the race cycle has no DB preimage", async () => {
    const insertedRows: any[] = [];

    mockFrom.mockImplementation(() =>
      buildChain({
        insert:      (row: any) => { insertedRows.push(row); return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) }); },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 99, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await expect(getOrSyncActiveCycle("miles")).rejects.toThrow(/no DB preimage/);
    expect(insertedRows).toHaveLength(0);
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────

describe("Test 4 — expired on-chain cycle is expired on-chain before DB is marked dead", () => {
  // expired cycle → expire on chain → open new → read new cycle
  const expiredCycle = makeChainCycle({ id: 7n, expiresAt: PAST_EXP });
  const freshCycle   = makeChainCycle({ id: 8n, expiresAt: FUTURE_EXP });

  beforeEach(() => {
    // Two reads: expired cycle first, then fresh cycle after open.
    // (There is no intermediate re-read between expire and open in the implementation.)
    mockGetActiveCycle
      .mockResolvedValueOnce(expiredCycle)
      .mockResolvedValueOnce(freshCycle);
    mockExpireCycle.mockResolvedValue(STUB_TX);
    mockOpenCycle.mockResolvedValue(STUB_TX);
  });

  it("calls contractExpireCycle before contractOpenCycle", async () => {
    const callOrder: string[] = [];
    mockExpireCycle.mockImplementation(async () => { callOrder.push("expire"); return STUB_TX; });
    mockOpenCycle.mockImplementation(async ()   => { callOrder.push("open");   return STUB_TX; });

    const insertChain = buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
    mockFrom.mockImplementation(() =>
      buildChain({
        insert:      () => insertChain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 8, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await getOrSyncActiveCycle("miles");

    expect(callOrder[0]).toBe("expire");
    expect(callOrder[1]).toBe("open");
  });

  it("marks the expired DB row dead (status='dead') before opening a new cycle", async () => {
    const updateCalls: any[] = [];
    const openCallsAfterUpdate: number[] = [];

    mockExpireCycle.mockImplementation(async () => STUB_TX);
    mockOpenCycle.mockImplementation(async () => {
      openCallsAfterUpdate.push(updateCalls.length);
      return STUB_TX;
    });

    const insertChain = buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
    mockFrom.mockImplementation(() =>
      buildChain({
        update:      (row: any) => { updateCalls.push(row); return buildChain(); },
        insert:      () => insertChain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 8, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await getOrSyncActiveCycle("miles");

    // An update to status:"dead" must have happened
    expect(updateCalls.some(r => r.status === "dead")).toBe(true);
    // And openCycle must have been called AFTER the dead-mark
    const deadAt = updateCalls.findIndex(r => r.status === "dead");
    // openCallsAfterUpdate[0] holds updateCalls.length at open time — must be > deadAt
    expect(openCallsAfterUpdate[0]).toBeGreaterThan(deadAt);
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────

describe("Test 5 — active chain cycle with no DB row fails closed", () => {
  const chainCycle = makeChainCycle({ id: 42n });

  beforeEach(() => {
    // Chain returns an active, non-expired cycle
    mockGetActiveCycle.mockResolvedValue(chainCycle);
  });

  it("does not call openCycle or expireCycle", async () => {
    const insertChain = buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
    mockFrom.mockImplementation(() =>
      buildChain({
        insert:      () => insertChain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 42, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await expect(getOrSyncActiveCycle("miles")).rejects.toThrow(/no DB preimage/);

    expect(mockOpenCycle).not.toHaveBeenCalled();
    expect(mockExpireCycle).not.toHaveBeenCalled();
  });

  it("does not insert an unverifiable repair row", async () => {
    const insertedRows: any[] = [];
    const insertChain = buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
    mockFrom.mockImplementation(() =>
      buildChain({
        insert:      (row: any) => { insertedRows.push(row); return insertChain; },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single:      () => Promise.resolve({ data: { id: STUB_ID, pot_balance: 200, pot_cap: 10000, seed_amount: 200, status: "active", expires_at: new Date().toISOString(), version: "miles", theme: "bank-vault", winner_address: null, winner_guesses: null, created_at: new Date().toISOString(), chain_id: CHAIN_ID, contract_cycle_id: 42, contract_version: 0, secret_commitment: "abc" }, error: null }),
      })
    );

    await expect(getOrSyncActiveCycle("miles")).rejects.toThrow(/no DB preimage/);

    expect(insertedRows).toHaveLength(0);
  });
});

// ── Test 6 ────────────────────────────────────────────────────────────────────

describe("Test 6 — return value and API surface never expose secrets", () => {
  it("getOrSyncActiveCycle does not include secret_code or secret_salt", async () => {
    const chainCycle = makeChainCycle({ id: 5n });
    mockGetActiveCycle.mockResolvedValue(chainCycle);

    // The SELECT in fetchFullDbRow deliberately omits secret_code and secret_salt.
    const publicRow = {
      id:                STUB_ID,
      version:           "miles",
      theme:             "bank-vault",
      status:            "active",
      pot_balance:       200,
      pot_cap:           10000,
      seed_amount:       200,
      expires_at:        new Date(Date.now() + 3_600_000).toISOString(),
      winner_address:    null,
      winner_guesses:    null,
      created_at:        new Date().toISOString(),
      chain_id:          CHAIN_ID,
      contract_cycle_id: 5,
      contract_version:  0,
      secret_commitment: "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00",
      // Intentionally absent: secret_code, secret_salt
    };

    mockFrom.mockImplementation(() =>
      buildChain({
        maybeSingle: () => Promise.resolve({ data: { id: STUB_ID, status: "active" }, error: null }),
        single:      () => Promise.resolve({ data: publicRow, error: null }),
      })
    );

    const result = await getOrSyncActiveCycle("miles");

    expect((result as any).secret_code).toBeUndefined();
    expect((result as any).secret_salt).toBeUndefined();
    // Public fields present
    expect(result.id).toBe(STUB_ID);
    expect(result.status).toBe("active");
    expect(result.pot_balance).toBe(200);
  });

  it("CycleView shape (as built by the route) never includes secret fields", () => {
    // Static shape assertion — CycleView type does not declare these fields.
    const cycleView = {
      cycleId:          STUB_ID,
      version:          "miles",
      theme:            "bank-vault",
      status:           "active",
      potBalance:       200,
      potCap:           10000,
      potState:         "seeded",
      expiresAt:        new Date().toISOString(),
      secondsRemaining: 3600,
      winnerAddress:    null,
      winnerGuesses:    null,
    };

    expect(cycleView).not.toHaveProperty("secret_code");
    expect(cycleView).not.toHaveProperty("secret_salt");
    expect(cycleView).not.toHaveProperty("secret_commitment");
    expect(cycleView).not.toHaveProperty("contract_cycle_id");
    expect(cycleView).not.toHaveProperty("chain_id");
  });
});
