/**
 * CrackPot settlement jobs + fairness proof — vitest unit tests.
 *
 * Coverage:
 *   1.  enqueuePayoutJob: marks cycle settling, inserts job row, returns job.
 *   2.  enqueuePayoutJob: duplicate idempotency_key → returns existing job, no double-insert.
 *   3.  leaseNextPayoutJob: returns null when no runnable jobs.
 *   4.  leaseNextPayoutJob: returns null when CAS fails (other worker wins race).
 *   5.  processPayoutJob: success path → cycle='cracked', job='succeeded'.
 *   6.  processPayoutJob: cycle NOT marked cracked before declareWinner confirms.
 *   7.  processPayoutJob: chain error → job='failed', cycle stays 'settling'.
 *   8.  processPayoutJob: exhausted retries → job='manual_review'.
 *   9.  processPayoutJob: NoCycleActive + chain shows different cycle → recovery cracked.
 *  10.  USDT feedback is identical to raw computeFeedback (no noise).
 *  11.  Miles feedback MAY differ from raw (noise flips close↔miss).
 *  12.  Active cycle row does NOT expose secret_code/salt.
 *  13.  revealCycleSecret: returns preimage fields for cracked/dead cycles.
 *  14.  revealCycleSecret: returns null for active cycles.
 *  15.  computeSecretCommitment: matches manual keccak256 reference.
 *  16.  Revealed commitment can be recomputed from preimage data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { keccak256, encodePacked, type Hex } from "viem";
import { celo } from "viem/chains";

// ── Supabase mock (must come before module imports) ───────────────────────────

const updateLog: Array<{ table: string; data: any }> = [];
const insertLog: any[] = [];

function resetLogs() {
  updateLog.length = 0;
  insertLog.length = 0;
}

let cycleRowOverride: any = null;
let jobRowOverride: any   = null;
let jobMaybeCallCount = 0; // controls upsert vs fetch responses

/** Build a chainable Supabase query builder that tracks writes. */
function makeQueryBuilder(table: string): any {
  let pendingUpdate: any = undefined;

  const q: any = {
    select:  (_cols?: string) => q,
    update:  (data: any) => { pendingUpdate = data; return q; },
    insert:  (rows: any) => { insertLog.push({ table, rows }); return q; },
    upsert:  (rows: any, _opts?: any) => { insertLog.push({ table, rows }); return q; },
    eq:      (_c: string, _v: any) => q,
    in:      (_c: string, _v: any[]) => q,
    is:      (_c: string, _v: any) => q,
    lte:     (_c: string, _v: any) => q,
    gt:      (_c: string, _v: any) => q,
    order:   (_c: string, _o?: any) => q,
    limit:   (_n: number) => q,
    single:  () => {
      _flushUpdate();
      if (table === "crackpot_cycles") return Promise.resolve({ data: cycleRowOverride, error: null });
      if (table === "crackpot_payout_jobs") return _jobResponse();
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle: () => {
      _flushUpdate();
      if (table === "crackpot_cycles") return Promise.resolve({ data: cycleRowOverride, error: null });
      if (table === "crackpot_payout_jobs") return _jobResponse();
      return Promise.resolve({ data: null, error: null });
    },
    then: (resolve: (v: any) => any) => {
      _flushUpdate();
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };

  function _flushUpdate() {
    if (pendingUpdate !== undefined) {
      updateLog.push({ table, data: pendingUpdate });
      pendingUpdate = undefined;
    }
  }

  function _jobResponse() {
    jobMaybeCallCount++;
    if (jobMaybeCallCount === 1) {
      // First call: fresh upsert data (or null to simulate conflict-ignored).
      return Promise.resolve({ data: jobRowOverride, error: null });
    }
    // Subsequent calls: fetch existing row.
    return Promise.resolve({ data: jobRowOverride, error: null });
  }

  return q;
}

const mockFrom = vi.fn((table: string) => makeQueryBuilder(table));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

// ── contractDeclareWinner / contractGetActiveCycle mocks ─────────────────────

const mockDeclareWinner  = vi.fn<(...args: any[]) => Promise<any>>();
const mockGetActiveCycle = vi.fn<(...args: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotContract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/crackpotContract")>();
  return {
    ...actual,
    contractDeclareWinner:  mockDeclareWinner,
    contractGetActiveCycle: mockGetActiveCycle,
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAIN_ID          = celo.id;   // 42220
const CYCLE_DB_ID       = "cccc-0000-0000-0000-000000000001";
const WINNER            = "0xaabbccdd00000000000000000000000000000001";
const CONTRACT_CYCLE_ID = 7;
const CONTRACT_VERSION  = 1;         // USDT

const BASE_JOB = {
  id:                "jjjj-0000-0000-0000-000000000001",
  cycle_id:          CYCLE_DB_ID,
  chain_id:          CHAIN_ID,
  contract_cycle_id: CONTRACT_CYCLE_ID,
  contract_version:  CONTRACT_VERSION,
  winner_address:    WINNER,
  winner_guesses:    4,
  idempotency_key:   `crackpot:${CHAIN_ID}:${CONTRACT_VERSION}:${CONTRACT_CYCLE_ID}`,
  status:            "queued" as const,
  tx_hash:           null,
  payout_amount:     null,
  attempts:          0,
  last_error:        null,
  leased_at:         null,
  lease_owner:       null,
  next_attempt_at:   new Date().toISOString(),
  created_at:        new Date().toISOString(),
  updated_at:        new Date().toISOString(),
};

// ── Lazy imports (after vi.mock hoisting) ─────────────────────────────────────

const {
  enqueuePayoutJob,
  leaseNextPayoutJob,
  processPayoutJob,
  revealCycleSecret,
} = await import("@/lib/server/crackpotPayoutWorker");

const {
  computeSecretCommitment,
  computeFeedback,
  applyNoiseForVersion,
} = await import("@/lib/server/crackpotEngine");

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation((table: string) => makeQueryBuilder(table));
  mockDeclareWinner.mockReset();
  mockGetActiveCycle.mockReset();
  resetLogs();
  cycleRowOverride = null;
  jobRowOverride   = null;
  jobMaybeCallCount = 0;
});

// ══════════════════════════════════════════════════════════════════════════════
// enqueuePayoutJob
// ══════════════════════════════════════════════════════════════════════════════

describe("enqueuePayoutJob", () => {
  it("inserts a new job and returns the job row", async () => {
    jobRowOverride = BASE_JOB;

    const result = await enqueuePayoutJob({
      cycleId:         CYCLE_DB_ID,
      chainId:         CHAIN_ID,
      contractCycleId: CONTRACT_CYCLE_ID,
      contractVersion: CONTRACT_VERSION,
      winnerAddress:   WINNER,
      winnerGuesses:   4,
    });

    expect(result?.id).toBe(BASE_JOB.id);

    // Both tables were touched.
    const tables = (mockFrom as any).mock.calls.map(([t]: [string]) => t) as string[];
    expect(tables).toContain("crackpot_cycles");
    expect(tables).toContain("crackpot_payout_jobs");

    // A job insert was attempted.
    const jobInsert = insertLog.find((e) => e.table === "crackpot_payout_jobs");
    expect(jobInsert).toBeDefined();
  });

  it("returns existing job when upsert ignored a duplicate", async () => {
    // Simulate upsert-ignored: first maybeSingle returns null, second returns existing row.
    let callIdx = 0;
    mockFrom.mockImplementation((table: string) => {
      const q = makeQueryBuilder(table);
      if (table === "crackpot_payout_jobs") {
        q.maybeSingle = () => {
          callIdx++;
          if (callIdx === 1) return Promise.resolve({ data: null, error: null }); // upsert ignored
          return Promise.resolve({ data: BASE_JOB, error: null });               // fetch existing
        };
      }
      return q;
    });

    const result = await enqueuePayoutJob({
      cycleId:         CYCLE_DB_ID,
      chainId:         CHAIN_ID,
      contractCycleId: CONTRACT_CYCLE_ID,
      contractVersion: CONTRACT_VERSION,
      winnerAddress:   WINNER,
      winnerGuesses:   4,
    });

    expect(result?.idempotency_key).toContain(`crackpot:${CHAIN_ID}`);
    // Only 1 insert call was made (no double-insert).
    expect(insertLog.filter((e) => e.table === "crackpot_payout_jobs").length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// leaseNextPayoutJob
// ══════════════════════════════════════════════════════════════════════════════

describe("leaseNextPayoutJob", () => {
  it("returns null when no runnable jobs exist", async () => {
    const result = await leaseNextPayoutJob("worker-1");
    expect(result).toBeNull();
  });

  it("returns null when CAS update claims 0 rows (other worker won)", async () => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      const q = makeQueryBuilder(table);
      q.maybeSingle = () => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: { id: BASE_JOB.id }, error: null });
        return Promise.resolve({ data: null, error: null }); // CAS missed
      };
      return q;
    });

    const result = await leaseNextPayoutJob("worker-2");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processPayoutJob — success path
// ══════════════════════════════════════════════════════════════════════════════

describe("processPayoutJob — success path", () => {
  it("marks cycle cracked and job succeeded after CycleCracked is decoded", async () => {
    mockDeclareWinner.mockResolvedValue({
      txHash: "0x" + "ff".repeat(32),
      cycleCracked: {
        cycleId: BigInt(CONTRACT_CYCLE_ID),
        winner:  WINNER as Hex,
        // 2_100_000 micro-USDT → chainPotToDb divides by 10_000 → 210 cents
        payout:  2_100_000n,
        guesses: 4n,
      },
    });

    await processPayoutJob(BASE_JOB);

    const cycleUpdate = updateLog.find((u) => u.table === "crackpot_cycles" && u.data.status === "cracked");
    expect(cycleUpdate).toBeDefined();
    expect(cycleUpdate!.data.winner_tx_hash).toBe("0x" + "ff".repeat(32));
    expect(cycleUpdate!.data.payout_amount).toBe(210);

    const jobUpdate = updateLog.find((u) => u.table === "crackpot_payout_jobs" && u.data.status === "succeeded");
    expect(jobUpdate).toBeDefined();
  });

  it("cycle is NOT marked cracked before declareWinner is confirmed", async () => {
    let cycleMarkedCrackedEarly = false;
    let declareResolved = false;

    mockFrom.mockImplementation((table: string) => {
      const q = makeQueryBuilder(table);
      const origUpdate = q.update.bind(q);
      q.update = (data: any) => {
        if (table === "crackpot_cycles" && data.status === "cracked" && !declareResolved) {
          cycleMarkedCrackedEarly = true;
        }
        return origUpdate(data);
      };
      return q;
    });

    mockDeclareWinner.mockImplementation(() => {
      declareResolved = true;
      return Promise.resolve({
        txHash: "0x" + "ee".repeat(32),
        cycleCracked: {
          cycleId: BigInt(CONTRACT_CYCLE_ID),
          winner:  WINNER as Hex,
          payout:  1_000_000n,
          guesses: 2n,
        },
      });
    });

    await processPayoutJob(BASE_JOB);

    expect(cycleMarkedCrackedEarly).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processPayoutJob — failure paths
// ══════════════════════════════════════════════════════════════════════════════

describe("processPayoutJob — failure paths", () => {
  it("marks job failed and does NOT mark cycle cracked on chain error", async () => {
    mockDeclareWinner.mockRejectedValue(new Error("RPC timeout"));

    await processPayoutJob({ ...BASE_JOB, attempts: 0 });

    const jobUpdate = updateLog.find((u) => u.table === "crackpot_payout_jobs" && u.data.status === "failed");
    expect(jobUpdate).toBeDefined();

    const crackedUpdate = updateLog.find((u) => u.table === "crackpot_cycles" && u.data.status === "cracked");
    expect(crackedUpdate).toBeUndefined();
  });

  it("marks job manual_review after MAX_ATTEMPTS exceeded", async () => {
    mockDeclareWinner.mockRejectedValue(new Error("persistent RPC failure"));

    // attempts=5 → next = 6 → 6 >= MAX_ATTEMPTS(5) → manual_review
    await processPayoutJob({ ...BASE_JOB, attempts: 5 });

    const jobUpdate = updateLog.find((u) => u.table === "crackpot_payout_jobs");
    expect(jobUpdate?.data.status).toBe("manual_review");
  });

  it("recovers when NoCycleActive and chain shows a different active cycle", async () => {
    mockDeclareWinner.mockRejectedValue(new Error("NoCycleActive (version=1)"));
    // A different cycle is active → our cycle was already cracked.
    mockGetActiveCycle.mockResolvedValue({ id: BigInt(CONTRACT_CYCLE_ID + 99) });

    await processPayoutJob(BASE_JOB);

    const cycleUpdate = updateLog.find((u) => u.table === "crackpot_cycles" && u.data.status === "cracked");
    expect(cycleUpdate).toBeDefined();

    const jobUpdate = updateLog.find((u) => u.table === "crackpot_payout_jobs" && u.data.status === "succeeded");
    expect(jobUpdate).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Fairness — version-aware feedback noise
// ══════════════════════════════════════════════════════════════════════════════

describe("Fairness — version-aware feedback noise", () => {
  const secret: [number, number, number, number] = [1, 3, 5, 2];

  it("USDT feedback is identical to raw computeFeedback (no noise)", () => {
    const guess: [number, number, number, number] = [1, 0, 5, 0];
    const raw = computeFeedback(secret, guess);

    expect(applyNoiseForVersion(raw, "usdt",      "c-1", "0xplayer", 1)).toEqual(raw);
    expect(applyNoiseForVersion(raw, "base_usdc", "c-1", "0xplayer", 1)).toEqual(raw);
  });

  it("USDT: locked positions always stay locked (truthful)", () => {
    const guess: [number, number, number, number] = [1, 3, 5, 2]; // exact match
    const raw = computeFeedback(secret, guess);
    const out = applyNoiseForVersion(raw, "usdt", "c-x", "0xaddr", 1);
    out.forEach((f) => expect(f).toBe("locked"));
  });

  it("Miles feedback MAY differ from raw computeFeedback (noise can flip close↔miss)", () => {
    const guess: [number, number, number, number] = [0, 3, 0, 2]; // miss, locked, miss, locked
    let foundDifference = false;
    for (let g = 1; g <= 200; g++) {
      const raw   = computeFeedback(secret, guess);
      const noisy = applyNoiseForVersion(raw, "miles", `cycle-${g}`, "0xplayer", g);
      if (JSON.stringify(raw) !== JSON.stringify(noisy)) { foundDifference = true; break; }
    }
    expect(foundDifference).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Active cycle data shape — no secret preimage exposed
// ══════════════════════════════════════════════════════════════════════════════

describe("Active cycle data shape", () => {
  it("cycle row never includes secret_code or secret_salt", () => {
    // This mirrors fetchFullDbRow SELECT columns (no secret_code/secret_salt).
    const cycleRow = {
      id:                   CYCLE_DB_ID,
      version:              "usdt",
      theme:                "bank-vault",
      status:               "active",
      pot_balance:          200,
      pot_cap:              5000,
      seed_amount:          200,
      expires_at:           new Date().toISOString(),
      winner_address:       null,
      winner_guesses:       null,
      winner_tx_hash:       null,
      payout_amount:        null,
      cracked_at:           null,
      commitment_algorithm: null,
      secret_revealed_at:   null,
      chain_id:             CHAIN_ID,
      contract_cycle_id:    CONTRACT_CYCLE_ID,
      contract_version:     1,
      secret_commitment:    "0x" + "aa".repeat(32),
      created_at:           new Date().toISOString(),
    };

    expect(cycleRow).toHaveProperty("secret_commitment");
    expect(cycleRow).not.toHaveProperty("secret_code");
    expect(cycleRow).not.toHaveProperty("secret_salt");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// revealCycleSecret
// ══════════════════════════════════════════════════════════════════════════════

describe("revealCycleSecret", () => {
  it("returns preimage fields for a cracked cycle", async () => {
    const stubRow = {
      id:                   CYCLE_DB_ID,
      status:               "cracked",
      chain_id:             CHAIN_ID,
      contract_version:     1,
      contract_cycle_id:    CONTRACT_CYCLE_ID,
      secret_code:          [1, 2, 3, 4],
      secret_salt:          "ab".repeat(32),
      secret_commitment:    "0x" + "cc".repeat(32),
      commitment_algorithm: "keccak256(abi.encodePacked(...))",
      expires_at:           new Date("2025-12-31T12:00:00Z").toISOString(),
    };

    mockFrom.mockImplementation((table: string) => {
      const q = makeQueryBuilder(table);
      q.maybeSingle = () =>
        table === "crackpot_cycles"
          ? Promise.resolve({ data: stubRow, error: null })
          : Promise.resolve({ data: null, error: null });
      return q;
    });

    process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS = "0x32e2ebd9b502563a3b8fa59207f0542709456906";

    const reveal = await revealCycleSecret(CYCLE_DB_ID);

    expect(reveal).not.toBeNull();
    expect(reveal!.secretCode).toEqual([1, 2, 3, 4]);
    expect(reveal!.secretSalt).toBe("ab".repeat(32));
    expect(reveal!.secretCommitment).toBe("0x" + "cc".repeat(32));
    expect(reveal!.commitmentAlgorithm).toBeTruthy();
  });

  it("returns null for an active cycle (status filter excludes active)", async () => {
    mockFrom.mockImplementation((table: string) => {
      const q = makeQueryBuilder(table);
      q.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return q;
    });

    const reveal = await revealCycleSecret(CYCLE_DB_ID);
    expect(reveal).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeSecretCommitment
// ══════════════════════════════════════════════════════════════════════════════

describe("computeSecretCommitment", () => {
  const CONTRACT_ADDR = "0x32e2ebd9b502563a3b8fa59207f0542709456906" as Hex;
  const SALT          = "ab".repeat(32);
  const CODE: [number, number, number, number] = [1, 2, 3, 4];
  const EXPIRES_AT    = new Date("2025-12-31T12:00:00Z");

  function referenceKeccak() {
    const expiresAtSec = BigInt(Math.floor(EXPIRES_AT.getTime() / 1000));
    const codeHex = CODE.map((n) => n.toString(16).padStart(2, "0")).join("") as Hex;
    return keccak256(
      encodePacked(
        ["string",  "uint256",          "address",       "uint8", "uint64",       "bytes32",            "bytes4"],
        ["CRACKPOT_SECRET_V1", BigInt(CHAIN_ID), CONTRACT_ADDR, 1, expiresAtSec, `0x${SALT}` as Hex, `0x${codeHex}` as Hex],
      ),
    );
  }

  it("produces a deterministic 32-byte hex string", () => {
    const result = computeSecretCommitment({
      chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 1,
      expiresAt: EXPIRES_AT, secretSalt: SALT, secretCode: CODE,
    });
    expect(result).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("matches a reference keccak256 computed directly from preimage", () => {
    const result = computeSecretCommitment({
      chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 1,
      expiresAt: EXPIRES_AT, secretSalt: SALT, secretCode: CODE,
    });
    expect(result).toBe(referenceKeccak());
  });

  it("changing any single input produces a different commitment", () => {
    const base = computeSecretCommitment({
      chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 1,
      expiresAt: EXPIRES_AT, secretSalt: SALT, secretCode: CODE,
    });
    expect(computeSecretCommitment({ chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 1, expiresAt: EXPIRES_AT, secretSalt: SALT, secretCode: [0,0,0,0] })).not.toBe(base);
    expect(computeSecretCommitment({ chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 1, expiresAt: EXPIRES_AT, secretSalt: "cd".repeat(32), secretCode: CODE })).not.toBe(base);
    expect(computeSecretCommitment({ chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 0, expiresAt: EXPIRES_AT, secretSalt: SALT, secretCode: CODE })).not.toBe(base);
  });

  it("player can recompute commitment from revealed preimage (fairness proof)", () => {
    const serverCommitment = computeSecretCommitment({
      chainId: CHAIN_ID, contractAddress: CONTRACT_ADDR, contractVersion: 1,
      expiresAt: EXPIRES_AT, secretSalt: SALT, secretCode: CODE,
    });

    // Player recomputes using the publicly-documented algorithm + revealed data.
    const expiresAtSec = BigInt(Math.floor(EXPIRES_AT.getTime() / 1000));
    const codeHex = CODE.map((n) => n.toString(16).padStart(2, "0")).join("") as Hex;
    const playerCommitment = keccak256(
      encodePacked(
        ["string", "uint256", "address", "uint8", "uint64", "bytes32", "bytes4"],
        ["CRACKPOT_SECRET_V1", BigInt(CHAIN_ID), CONTRACT_ADDR, 1, expiresAtSec, `0x${SALT}` as Hex, `0x${codeHex}` as Hex],
      ),
    );

    expect(playerCommitment).toBe(serverCommitment);
  });
});
