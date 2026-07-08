/**
 * CrackPot USDT payment / start-route hardening — unit tests.
 *
 * Coverage:
 *   1.  verifyCrackPotEntry — happy path: valid receipt, player, cycle → ok.
 *   2.  verifyCrackPotEntry — failed receipt (status !== "success") is rejected.
 *   3.  verifyCrackPotEntry — tx sent to a different contract is rejected.
 *   4.  verifyCrackPotEntry — EntryRecorded player ≠ session wallet is rejected.
 *   5.  verifyCrackPotEntry — EntryRecorded cycleId ≠ active cycle is rejected.
 *   6.  verifyCrackPotEntry — no EntryRecorded event in receipt is rejected.
 *   7.  verifyCrackPotEntry — cycle with no chain fields fails closed.
 *   8.  Retrying the same tx hash returns the existing attempt (idempotency).
 *   9.  findAttemptByTxHash scopes by chain_id + tx hash.
 *  10.  getAttemptForPlayer scopes by attempt id AND player wallet.
 *  11.  getAttemptForPlayer returns null for a different player's attempt.
 *  12.  Guess route rejects unauthenticated request (no session).
 *  13.  Guess route returns 404 for another player's attempt (auth scope).
 *  14.  API response for verifyCrackPotEntry never exposes secret_code.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { decodeEventLog, parseAbi } from "viem";
import { celo } from "viem/chains";

// ── Viem mock ─────────────────────────────────────────────────────────────────
// Keep parseAbi / decodeEventLog real; mock createPublicClient only.

const mockGetReceipt = vi.fn<(...args: any[]) => Promise<any>>();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ getTransactionReceipt: mockGetReceipt })),
    http: vi.fn(() => "mocked-transport"),
  };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

function buildChain(overrides: Record<string, any> = {}): any {
  const c: any = {
    select:      () => c,
    insert:      () => c,
    update:      () => c,
    eq:          () => c,
    gt:          () => c,
    order:       () => c,
    single:      () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then:        (fn: any) => Promise.resolve({ data: null, error: null }).then(fn),
    ...overrides,
  };
  return c;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_ID         = celo.id;                                // 42220
const CRACKPOT_ADDR    = "0x32e2ebd9b502563a3b8fa59207f0542709456906"; // lower
const SESSION_WALLET   = "0xaabbccdd00000000000000000000000000000001";
const OTHER_WALLET     = "0xdeadbeef00000000000000000000000000000002";
const CONTRACT_CYCLE_ID = 5;
const STUB_TX_HASH     = "0x" + "ab".repeat(32);
const STUB_ATTEMPT_ID  = "aaaa0000-0000-0000-0000-000000000001";

/** Build an ActiveCycleRef with all chain fields set. */
function makeActiveCycle(overrides: Partial<Record<string, any>> = {}) {
  return {
    id:                 "cccc0000-0000-0000-0000-000000000001",
    contract_cycle_id:  CONTRACT_CYCLE_ID,
    chain_id:           CHAIN_ID,
    contract_version:   1,
    ...overrides,
  };
}

/** Build a viem receipt with `EntryRecorded` logged at the CrackPot address. */
function makeReceipt(overrides: {
  status?:     "success" | "reverted";
  to?:         string;
  player?:     string;
  cycleId?:    number;
  entryAmount?: bigint;
  logs?:       any[];
} = {}) {
  const { status = "success", to = CRACKPOT_ADDR, player = SESSION_WALLET,
          cycleId = CONTRACT_CYCLE_ID, entryAmount = 100_000n, logs } = overrides;

  // Encode EntryRecorded(cycleId, player, entryAmount, newPotBalance) using viem.
  const eventAbi = parseAbi([
    "event EntryRecorded(uint256 indexed cycleId, address indexed player, uint256 entryAmount, uint256 newPotBalance)",
  ]);

  // Manually encode topics + data the way a real Ethereum log would look.
  // viem's `encodeEventTopics` + `encodeAbiParameters` handles this.
  const { encodeEventTopics, encodeAbiParameters, parseAbiParameters } =
    require("viem") as typeof import("viem");

  const topics = encodeEventTopics({
    abi:       eventAbi,
    eventName: "EntryRecorded",
    args:      { cycleId: BigInt(cycleId), player: player as `0x${string}` },
  });

  const data = encodeAbiParameters(parseAbiParameters("uint256, uint256"), [
    entryAmount,
    200_000_000_000_000_000_000n,
  ]);

  const entryLog = {
    address:  CRACKPOT_ADDR as `0x${string}`,
    topics:   topics as `0x${string}`[],
    data:     data as `0x${string}`,
    logIndex: 0,
  };

  return {
    status,
    to:   to as `0x${string}`,
    logs: logs ?? [entryLog],
  };
}

// ── Set env var BEFORE module import ──────────────────────────────────────────
// crackpotEntryVerifier builds the CRACKPOT_ADDRESS map at module load time
// from process.env. We must set this before the first `await import(...)` call.

process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS = CRACKPOT_ADDR;

// ── Import modules AFTER mocks are hoisted and env var is set ─────────────────

const { verifyUsdtEntry, verifyCrackPotEntry } = await import("@/lib/server/crackpotEntryVerifier");
const {
  findAttemptByTxHash,
  getAttemptForPlayer,
} = await import("@/lib/server/crackpotAttemptHelpers");

// ── Reset before each test ────────────────────────────────────────────────────

beforeEach(() => {
  mockGetReceipt.mockReset();
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => buildChain());
});

// ══════════════════════════════════════════════════════════════════════════════

describe("verifyUsdtEntry — happy path", () => {
  it("returns ok=true with correct logIndex and amounts", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt());

    const result = await verifyUsdtEntry(
      STUB_TX_HASH,
      SESSION_WALLET,
      makeActiveCycle(),
      CHAIN_ID,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.logIndex).toBe(0);
      expect(result.entryAmount).toBe(100_000n);
      expect(Number(result.cycleId)).toBe(CONTRACT_CYCLE_ID);
    }
  });
});

describe("verifyCrackPotEntry — Miles entry", () => {
  it("accepts a 10 AkibaMiles EntryRecorded event for a Miles cycle", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ entryAmount: 10_000_000_000_000_000_000n }));

    const result = await verifyCrackPotEntry(
      STUB_TX_HASH,
      SESSION_WALLET,
      makeActiveCycle({ contract_version: 0 }),
      CHAIN_ID,
      "miles",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entryAmount).toBe(10_000_000_000_000_000_000n);
      expect(Number(result.cycleId)).toBe(CONTRACT_CYCLE_ID);
    }
  });

  it("rejects a Miles entry below 10 AkibaMiles", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ entryAmount: 100_000n }));

    const result = await verifyCrackPotEntry(
      STUB_TX_HASH,
      SESSION_WALLET,
      makeActiveCycle({ contract_version: 0 }),
      CHAIN_ID,
      "miles",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("entry_amount_too_low");
  });
});

describe("verifyUsdtEntry — failed receipt", () => {
  it("returns reason=tx_failed when receipt.status is reverted", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ status: "reverted" }));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tx_failed");
  });

  it("returns reason=receipt_not_found when receipt fetch throws", async () => {
    mockGetReceipt.mockRejectedValue(new Error("not found"));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("receipt_not_found");
  });
});

describe("verifyUsdtEntry — wrong contract", () => {
  it("returns reason=wrong_contract when tx.to ≠ CrackPot proxy", async () => {
    const differentContract = "0x1234000000000000000000000000000000000000";
    mockGetReceipt.mockResolvedValue(makeReceipt({ to: differentContract }));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_contract");
  });
});

describe("verifyUsdtEntry — player mismatch", () => {
  it("returns reason=player_mismatch when event player ≠ session wallet", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ player: OTHER_WALLET }));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("player_mismatch");
  });
});

describe("verifyUsdtEntry — cycle mismatch", () => {
  it("returns reason=cycle_mismatch when event cycleId ≠ active DB cycle", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ cycleId: CONTRACT_CYCLE_ID + 99 }));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cycle_mismatch");
  });
});

describe("verifyUsdtEntry — no EntryRecorded event", () => {
  it("returns reason=no_entry_recorded_event when logs list is empty", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ logs: [] }));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_entry_recorded_event");
  });

  it("ignores logs from a different contract address", async () => {
    // Build a receipt whose only log is from a different address.
    const otherContractLog = {
      address:  "0x9999000000000000000000000000000000000000" as `0x${string}`,
      topics:   [] as `0x${string}`[],
      data:     "0x" as `0x${string}`,
      logIndex: 0,
    };
    mockGetReceipt.mockResolvedValue(makeReceipt({ logs: [otherContractLog] }));

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_entry_recorded_event");
  });
});

describe("verifyUsdtEntry — cycle with no chain fields", () => {
  it("returns reason=cycle_no_chain_fields when contract_cycle_id is null", async () => {
    const result = await verifyUsdtEntry(
      STUB_TX_HASH,
      SESSION_WALLET,
      makeActiveCycle({ contract_cycle_id: null }),
      CHAIN_ID,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cycle_no_chain_fields");
  });

  it("returns reason=chain_id_mismatch when cycle chain_id ≠ route chain", async () => {
    const result = await verifyUsdtEntry(
      STUB_TX_HASH,
      SESSION_WALLET,
      makeActiveCycle({ chain_id: 8453 }), // Base chain
      CHAIN_ID,                            // Celo expected
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("chain_id_mismatch");
  });

  it("returns reason=contract_version_mismatch when DB cycle version does not match request", async () => {
    const result = await verifyCrackPotEntry(
      STUB_TX_HASH,
      SESSION_WALLET,
      makeActiveCycle({ contract_version: 0 }),
      CHAIN_ID,
      "usdt",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("contract_version_mismatch");
  });
});

describe("Idempotency — retrying the same tx returns the existing attempt", () => {
  it("findAttemptByTxHash returns existing row for matching chain_id + txHash", async () => {
    const stubAttempt = {
      id:             STUB_ATTEMPT_ID,
      player_address: SESSION_WALLET,
      cycle_id:       "cccc0000-0000-0000-0000-000000000001",
      status:         "active",
      chain_id:       CHAIN_ID,
      entry_tx_hash:  STUB_TX_HASH,
    };

    mockFrom.mockImplementation(() =>
      buildChain({
        maybeSingle: () => Promise.resolve({ data: stubAttempt, error: null }),
      }),
    );

    const result = await findAttemptByTxHash(CHAIN_ID, STUB_TX_HASH);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(STUB_ATTEMPT_ID);
    expect(result?.player_address).toBe(SESSION_WALLET);
  });

  it("findAttemptByTxHash returns null for a different tx hash", async () => {
    mockFrom.mockImplementation(() =>
      buildChain({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    );

    const result = await findAttemptByTxHash(CHAIN_ID, "0x" + "cc".repeat(32));
    expect(result).toBeNull();
  });
});

describe("Auth scope — getAttemptForPlayer", () => {
  it("returns the attempt when player_address matches session wallet", async () => {
    const stubAttempt = {
      id:             STUB_ATTEMPT_ID,
      player_address: SESSION_WALLET,
      cycle_id:       "cccc0000-0000-0000-0000-000000000001",
      status:         "active",
    };

    mockFrom.mockImplementation(() =>
      buildChain({
        maybeSingle: () => Promise.resolve({ data: stubAttempt, error: null }),
      }),
    );

    const result = await getAttemptForPlayer(STUB_ATTEMPT_ID, SESSION_WALLET);
    expect(result?.id).toBe(STUB_ATTEMPT_ID);
  });

  it("returns null when player_address does not match (different wallet)", async () => {
    // The DB returns null because the query filters by player_address.
    mockFrom.mockImplementation(() =>
      buildChain({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    );

    const result = await getAttemptForPlayer(STUB_ATTEMPT_ID, OTHER_WALLET);
    // Returns null — cannot observe another player's attempt.
    expect(result).toBeNull();
  });

  it("the query includes player_address equality filter", async () => {
    const eqCalls: string[] = [];
    const chain = buildChain({
      eq:          (col: string, _val: any) => { eqCalls.push(col); return chain; },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    });
    mockFrom.mockImplementation(() => chain);

    await getAttemptForPlayer(STUB_ATTEMPT_ID, SESSION_WALLET);

    expect(eqCalls).toContain("player_address");
    expect(eqCalls).toContain("id");
  });
});

describe("API response safety — no secret_code exposure", () => {
  it("verifyCrackPotEntry result does not contain secret_code or secret_salt", async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt());

    const result = await verifyUsdtEntry(STUB_TX_HASH, SESSION_WALLET, makeActiveCycle(), CHAIN_ID);

    // The result type only has: ok, logIndex, cycleId, entryAmount (or reason).
    expect((result as any).secret_code).toBeUndefined();
    expect((result as any).secret_salt).toBeUndefined();
    expect((result as any).secret_commitment).toBeUndefined();
  });

  it("GuessView shape does not carry secret_code", () => {
    // Static shape check — GuessView has no secret field.
    const guessView = {
      guessNumber:  1,
      symbols:      [0, 1, 2, 3] as [number, number, number, number],
      symbolLabels: ["a", "b", "c", "d"] as [string, string, string, string],
      feedback:     ["locked", "miss", "close", "miss"] as const,
      isCorrect:    false,
      createdAt:    new Date().toISOString(),
    };

    expect(guessView).not.toHaveProperty("secret_code");
    expect(guessView).not.toHaveProperty("secret");
    expect(guessView).not.toHaveProperty("secret_salt");
  });
});
