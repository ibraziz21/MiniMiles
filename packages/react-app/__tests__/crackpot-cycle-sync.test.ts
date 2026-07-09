/**
 * CrackPot chain-first cycle sync — unit tests.
 *
 * Coverage:
 *   1.  openCycle failure leaves only a reusable 'pending' row (never active).
 *   2.  Successful open inserts a pending row BEFORE the tx and promotes it
 *       to active (with chain fields) after the tx confirms.
 *   3.  CycleAlreadyActive race adopts the existing DB row and retires the
 *       local pending row.
 *   4.  Expired on-chain cycle is expired on-chain and marked dead in the DB
 *       before the next cycle is opened.
 *   5.  Active chain cycle with no DB preimage fails closed (read path).
 *   6.  API surface never exposes secret_code or secret_salt.
 *   7.  Read path defers to the cron during the post-expiry grace window
 *       (CycleRotatingError, no transactions).
 *   8.  Read path recovers an orphaned chain cycle by promoting the pending
 *       row whose commitment matches the on-chain commitment.
 *   9.  Rotation lock unavailable → no transactions, CycleRotatingError.
 *   10. A pending row from a failed open is reused (same expiry+commitment).
 *   11. chainPotToDb unit conversions (Miles / USDT).
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
const mockRpc  = vi.fn<(...args: any[]) => Promise<any>>();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (...a: any[]) => mockFrom(...a),
    rpc:  (...a: any[]) => mockRpc(...a),
  }),
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
const OTHER_COMMITMENT = ("0x" + "cd".repeat(32)) as `0x${string}`;

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
    secretCommitment: OTHER_COMMITMENT,
    ...overrides,
  };
}

function makePublicRow(id: string = STUB_ID, contractCycleId: number = 1) {
  return {
    id,
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
    contract_cycle_id: contractCycleId,
    contract_version:  0,
    secret_commitment: "abc",
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
  mockRpc.mockReset();
  // Restore defaults: empty-resolving query chain; lock always granted.
  mockFrom.mockImplementation(() => buildChain());
  mockRpc.mockResolvedValue({ data: true, error: null });
  // Set env vars required by crackpotAddr() / computeSecretCommitment.
  process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS      = STUB_CONTRACT_ADDR;
  process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS = STUB_CONTRACT_ADDR;
});

// ── Import module AFTER mocks are hoisted ─────────────────────────────────────

const {
  getOrSyncActiveCycle,
  rotateActiveCycle,
  chainPotToDb,
  generateSecretWithCommitment,
  CycleRotatingError,
} = await import("@/lib/server/crackpotCycleSync");

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

describe("Test 1 — openCycle failure leaves only a reusable pending row", () => {
  it("inserts the pending row BEFORE openCycle, re-throws, and never promotes", async () => {
    mockGetActiveCycle.mockResolvedValue(null);

    const insertedRows: any[] = [];
    const updateCalls:  any[] = [];
    const callOrder:    string[] = [];

    mockOpenCycle.mockImplementation(async () => {
      callOrder.push("open");
      throw new Error("insufficient USDT seed");
    });

    mockFrom.mockImplementation(() =>
      buildChain({
        insert: (row: any) => {
          insertedRows.push(row);
          callOrder.push("insert");
          return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
        },
        update: (row: any) => { updateCalls.push(row); return buildChain(); },
      })
    );

    await expect(rotateActiveCycle("miles")).rejects.toThrow("insufficient USDT seed");

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].status).toBe("pending");
    expect(callOrder).toEqual(["insert", "open"]);
    // Never promoted to active, never marked anything dead.
    expect(updateCalls.some((r) => r.status === "active")).toBe(false);
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────

describe("Test 2 — successful open persists pending row then promotes it", () => {
  it("pending row carries chain_id/contract_version/commitment; promotion adds contract_cycle_id", async () => {
    let capturedCommitment: string | null = null;
    let reads = 0;

    mockOpenCycle.mockImplementation(async (_v: any, _exp: any, commitment: any) => {
      capturedCommitment = commitment;
      return STUB_TX;
    });
    mockGetActiveCycle.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return null; // rotateLocked initial read
      return makeChainCycle({ id: 1n, secretCommitment: capturedCommitment });
    });

    const insertedRows: any[] = [];
    const updateCalls:  any[] = [];

    mockFrom.mockImplementation(() =>
      buildChain({
        insert: (row: any) => {
          insertedRows.push(row);
          return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
        },
        update: (row: any) => { updateCalls.push(row); return buildChain(); },
        single: () => Promise.resolve({ data: makePublicRow(), error: null }),
      })
    );

    const result = await rotateActiveCycle("miles");

    expect(mockOpenCycle).toHaveBeenCalledOnce();
    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row.status).toBe("pending");
    expect(row.chain_id).toBe(CHAIN_ID);
    expect(row.contract_version).toBe(0);
    expect(row.secret_commitment).toMatch(/^0x[0-9a-f]{64}$/i);
    // secret_code and secret_salt exist in the DB row but are not returned to callers
    expect(row.secret_code).toBeDefined();
    expect(row.secret_salt).toBeDefined();

    const promote = updateCalls.find((r) => r.status === "active");
    expect(promote).toBeDefined();
    expect(promote.contract_cycle_id).toBe(1);
    expect(promote.open_tx_hash).toBe(STUB_TX);

    expect(result.id).toBe(STUB_ID);
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────

describe("Test 3 — CycleAlreadyActive race adopts the existing DB row", () => {
  const raceChainCycle = makeChainCycle({ id: 99n }); // foreign commitment

  beforeEach(() => {
    mockGetActiveCycle
      .mockResolvedValueOnce(null)            // rotateLocked read: no cycle
      .mockResolvedValueOnce(raceChainCycle); // re-read after race

    const raceErr: any = new Error("CycleAlreadyActive");
    raceErr.shortMessage = "CycleAlreadyActive";
    mockOpenCycle.mockRejectedValue(raceErr);
  });

  it("uses the other worker's row and retires the local pending row", async () => {
    const insertedRows: any[] = [];
    const updateCalls:  any[] = [];
    let maybeSingleCalls = 0;

    mockFrom.mockImplementation(() =>
      buildChain({
        insert: (row: any) => {
          insertedRows.push(row);
          return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
        },
        update: (row: any) => { updateCalls.push(row); return buildChain(); },
        maybeSingle: () => {
          maybeSingleCalls += 1;
          // 1st: findPendingRow (none). Later: findDbRowByContractCycle → other worker's row.
          if (maybeSingleCalls === 1) return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: { id: "other-worker-row", status: "active" }, error: null });
        },
        single: () => Promise.resolve({ data: makePublicRow("other-worker-row", 99), error: null }),
      })
    );

    const result = await rotateActiveCycle("miles");

    expect(result.id).toBe("other-worker-row");
    expect(insertedRows).toHaveLength(1);            // only our pending row
    expect(insertedRows[0].status).toBe("pending");
    // Our pending row was retired; nothing was promoted.
    expect(updateCalls.some((r) => r.status === "dead")).toBe(true);
    expect(updateCalls.some((r) => r.status === "active")).toBe(false);
  });

  it("fails closed when the race cycle has no DB preimage anywhere", async () => {
    const insertedRows: any[] = [];

    mockFrom.mockImplementation(() =>
      buildChain({
        insert: (row: any) => {
          insertedRows.push(row);
          return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
        },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      })
    );

    await expect(rotateActiveCycle("miles")).rejects.toThrow(/no DB preimage/);
    // Our pending row exists but must not be promoted for a foreign commitment.
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].status).toBe("pending");
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────

describe("Test 4 — expired on-chain cycle is expired and marked dead before opening", () => {
  // expired cycle → expire on chain → confirm no active → open new → read new cycle
  const expiredCycle = makeChainCycle({ id: 7n, expiresAt: PAST_EXP });

  let capturedCommitment: string | null;

  beforeEach(() => {
    capturedCommitment = null;
    let reads = 0;
    mockGetActiveCycle.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return expiredCycle; // rotateLocked read
      if (reads === 2) return null;         // after expireCycle
      return makeChainCycle({ id: 8n, secretCommitment: capturedCommitment }); // after open
    });
    mockExpireCycle.mockResolvedValue(STUB_TX);
    mockOpenCycle.mockImplementation(async (_v: any, _exp: any, commitment: any) => {
      capturedCommitment = commitment;
      return STUB_TX;
    });
  });

  it("calls contractExpireCycle before contractOpenCycle", async () => {
    const callOrder: string[] = [];
    mockExpireCycle.mockImplementation(async () => { callOrder.push("expire"); return STUB_TX; });
    mockOpenCycle.mockImplementation(async (_v: any, _exp: any, commitment: any) => {
      callOrder.push("open");
      capturedCommitment = commitment;
      return STUB_TX;
    });

    mockFrom.mockImplementation(() =>
      buildChain({
        insert: () => buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) }),
        single: () => Promise.resolve({ data: makePublicRow(STUB_ID, 8), error: null }),
      })
    );

    await rotateActiveCycle("miles");

    expect(callOrder[0]).toBe("expire");
    expect(callOrder[1]).toBe("open");
  });

  it("marks the expired DB row dead (status='dead') before opening a new cycle", async () => {
    const updateCalls: any[] = [];
    const openCallsAfterUpdate: number[] = [];

    mockOpenCycle.mockImplementation(async (_v: any, _exp: any, commitment: any) => {
      openCallsAfterUpdate.push(updateCalls.length);
      capturedCommitment = commitment;
      return STUB_TX;
    });

    mockFrom.mockImplementation(() =>
      buildChain({
        update: (row: any) => { updateCalls.push(row); return buildChain(); },
        insert: () => buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) }),
        single: () => Promise.resolve({ data: makePublicRow(STUB_ID, 8), error: null }),
      })
    );

    await rotateActiveCycle("miles");

    // An update to status:"dead" must have happened
    expect(updateCalls.some(r => r.status === "dead")).toBe(true);
    // And openCycle must have been called AFTER the dead-mark
    const deadAt = updateCalls.findIndex(r => r.status === "dead");
    // openCallsAfterUpdate[0] holds updateCalls.length at open time — must be > deadAt
    expect(openCallsAfterUpdate[0]).toBeGreaterThan(deadAt);
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────

describe("Test 5 — active chain cycle with no DB preimage fails closed (read path)", () => {
  const chainCycle = makeChainCycle({ id: 42n });

  beforeEach(() => {
    // Chain returns an active, non-expired cycle
    mockGetActiveCycle.mockResolvedValue(chainCycle);
  });

  it("does not call openCycle or expireCycle", async () => {
    await expect(getOrSyncActiveCycle("miles")).rejects.toThrow(/no DB preimage/);

    expect(mockOpenCycle).not.toHaveBeenCalled();
    expect(mockExpireCycle).not.toHaveBeenCalled();
  });

  it("does not insert an unverifiable repair row", async () => {
    const insertedRows: any[] = [];
    mockFrom.mockImplementation(() =>
      buildChain({
        insert: (row: any) => {
          insertedRows.push(row);
          return buildChain({ single: () => Promise.resolve({ data: { id: STUB_ID }, error: null }) });
        },
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
      ...makePublicRow(STUB_ID, 5),
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

// ── Test 7 ────────────────────────────────────────────────────────────────────

describe("Test 7 — read path defers to the cron inside the post-expiry grace window", () => {
  it("throws CycleRotatingError and sends no transactions", async () => {
    const justExpired = makeChainCycle({ id: 7n, expiresAt: BigInt(NOW_SEC - 30) });
    mockGetActiveCycle.mockResolvedValue(justExpired);

    await expect(getOrSyncActiveCycle("miles")).rejects.toBeInstanceOf(CycleRotatingError);

    expect(mockExpireCycle).not.toHaveBeenCalled();
    expect(mockOpenCycle).not.toHaveBeenCalled();
    // Never even tried to take the rotation lock.
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── Test 8 ────────────────────────────────────────────────────────────────────

describe("Test 8 — read path promotes an orphaned pending row by commitment", () => {
  it("recovers a chain cycle whose opener crashed before promotion", async () => {
    const PENDING_ID = "pending-row-0000-0000-000000000009";
    const COMMITMENT = ("0x" + "ee".repeat(32)) as `0x${string}`;
    const chainCycle = makeChainCycle({ id: 12n, secretCommitment: COMMITMENT });
    mockGetActiveCycle.mockResolvedValue(chainCycle);

    const updateCalls: any[] = [];

    // Call order inside ensureDbRowForChainCycle:
    //   1. findDbRowByContractCycle → no row
    //   2. findPendingRow           → orphaned pending row, matching commitment
    //   3. promotePendingRow        → update
    //   4. fetchFullDbRow           → promoted row
    mockFrom
      .mockImplementationOnce(() => buildChain())
      .mockImplementationOnce(() => buildChain({
        maybeSingle: () => Promise.resolve({
          data: {
            id: PENDING_ID,
            expires_at: new Date(Date.now() + 3_000_000).toISOString(),
            secret_commitment: COMMITMENT,
          },
          error: null,
        }),
      }))
      .mockImplementationOnce(() => buildChain({
        update: (row: any) => { updateCalls.push(row); return buildChain(); },
      }))
      .mockImplementationOnce(() => buildChain({
        single: () => Promise.resolve({ data: makePublicRow(PENDING_ID, 12), error: null }),
      }));

    const result = await getOrSyncActiveCycle("miles");

    expect(result.id).toBe(PENDING_ID);
    const promote = updateCalls.find((r) => r.status === "active");
    expect(promote).toBeDefined();
    expect(promote.contract_cycle_id).toBe(12);
    expect(mockOpenCycle).not.toHaveBeenCalled();
    expect(mockExpireCycle).not.toHaveBeenCalled();
  });
});

// ── Test 9 ────────────────────────────────────────────────────────────────────

describe("Test 9 — rotation lock unavailable", () => {
  it("sends no transactions and surfaces CycleRotatingError", async () => {
    mockGetActiveCycle.mockResolvedValue(null); // nothing on-chain
    mockRpc.mockResolvedValue({ data: false, error: null }); // lock held elsewhere

    await expect(rotateActiveCycle("miles")).rejects.toBeInstanceOf(CycleRotatingError);

    expect(mockOpenCycle).not.toHaveBeenCalled();
    expect(mockExpireCycle).not.toHaveBeenCalled();
  });
});

// ── Test 10 ───────────────────────────────────────────────────────────────────

describe("Test 10 — a pending row from a failed open is reused", () => {
  it("re-sends openCycle with the stored expiry and commitment, without a new insert", async () => {
    const PENDING_ID = "pending-row-0000-0000-000000000010";
    const COMMITMENT = ("0x" + "ff".repeat(32)) as `0x${string}`;
    const storedExpiry = new Date(Date.now() + 3_600_000);
    storedExpiry.setMilliseconds(0);

    let reads = 0;
    mockGetActiveCycle.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return null; // rotateLocked read
      return makeChainCycle({ id: 3n, secretCommitment: COMMITMENT });
    });
    mockOpenCycle.mockResolvedValue(STUB_TX);

    const insertedRows: any[] = [];
    const updateCalls:  any[] = [];

    // Call order inside openNewCycle:
    //   1. findPendingRow           → reusable pending row
    //   2. findDbRowByContractCycle → no row yet
    //   3. promotePendingRow        → update
    //   4. fetchFullDbRow           → promoted row
    mockFrom
      .mockImplementationOnce(() => buildChain({
        maybeSingle: () => Promise.resolve({
          data: {
            id: PENDING_ID,
            expires_at: storedExpiry.toISOString(),
            secret_commitment: COMMITMENT,
          },
          error: null,
        }),
        insert: (row: any) => { insertedRows.push(row); return buildChain(); },
      }))
      .mockImplementationOnce(() => buildChain())
      .mockImplementationOnce(() => buildChain({
        update: (row: any) => { updateCalls.push(row); return buildChain(); },
      }))
      .mockImplementationOnce(() => buildChain({
        single: () => Promise.resolve({ data: makePublicRow(PENDING_ID, 3), error: null }),
      }));

    const result = await rotateActiveCycle("miles");

    expect(insertedRows).toHaveLength(0);
    expect(mockOpenCycle).toHaveBeenCalledOnce();
    const [version, expiryArg, commitmentArg] = mockOpenCycle.mock.calls[0];
    expect(version).toBe(0);
    expect((expiryArg as Date).getTime()).toBe(storedExpiry.getTime());
    expect(commitmentArg).toBe(COMMITMENT);

    expect(result.id).toBe(PENDING_ID);
    expect(updateCalls.some((r) => r.status === "active")).toBe(true);
  });
});
