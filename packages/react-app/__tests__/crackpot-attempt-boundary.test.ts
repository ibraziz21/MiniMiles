/**
 * CrackPot paid-entry boundary — unit tests.
 *
 * Coverage:
 *   1. Entry recorded into an earlier cycle (rotation raced the payment) →
 *      409 entry_cycle_rotated + orphaned-entry row, no attempt created.
 *   2. Valid entry but almost no cycle time left → 409 entry_too_late +
 *      orphaned-entry row, no attempt created.
 *   3. Valid entry near the cycle end → attempt window clamped to cycle end
 *      (maxExpiresAt passed to createAttempt).
 *   4. Cycle rotating → 503 cycle_rotating with Retry-After.
 *   5. Guess against a settling/retired cycle → 409 cycle_not_active.
 *   6. Guess after cycle expiry → 410 cycle_expired.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/server/crackpotComingSoon", () => ({
  isCrackPotLive: () => true,
  crackPotComingSoonResponse: () =>
    Response.json({ error: "crackpot_paused" }, { status: 503 }),
}));

const PLAYER = "0x1111111111111111111111111111111111111111";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn().mockResolvedValue({ walletAddress: PLAYER }),
}));

const mockGetOrSync = vi.fn<(...a: any[]) => Promise<any>>();

class FakeCycleRotatingError extends Error {
  readonly retryAfterSeconds = 5;
  constructor() { super("CrackPot cycle is rotating"); this.name = "CycleRotatingError"; }
}

vi.mock("@/lib/server/crackpotCycleSync", () => ({
  getOrSyncActiveCycle: (...a: any[]) => mockGetOrSync(...a),
  CycleRotatingError: FakeCycleRotatingError,
}));

const mockVerify = vi.fn<(...a: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotEntryVerifier", () => ({
  verifyCrackPotEntry: (...a: any[]) => mockVerify(...a),
}));

const mockCreateAttempt       = vi.fn<(...a: any[]) => Promise<any>>();
const mockGetAttemptForPlayer = vi.fn<(...a: any[]) => Promise<any>>();
const mockGetCycleSecret      = vi.fn<(...a: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotAttemptHelpers", () => ({
  findAttemptByTxHash:     vi.fn().mockResolvedValue(null),
  countAttemptsForPlayer:  vi.fn().mockResolvedValue({ total: 0, free: 0 }),
  createAttempt:           (...a: any[]) => mockCreateAttempt(...a),
  getGuessesForAttempt:    vi.fn().mockResolvedValue([]),
  getGuessesForCycle:      vi.fn().mockResolvedValue([]),
  buildAttemptView:        vi.fn().mockReturnValue({ attemptId: "attempt-1", status: "active" }),
  getCycleSecret:          (...a: any[]) => mockGetCycleSecret(...a),
  getAttemptForPlayer:     (...a: any[]) => mockGetAttemptForPlayer(...a),
  getCycleChainRef:        vi.fn().mockResolvedValue(null),
  submitGuess:             vi.fn(),
  settleWinningCycle:      vi.fn(),
}));

const mockRecordOrphan = vi.fn<(...a: any[]) => Promise<void>>();

vi.mock("@/lib/server/crackpotOrphanedEntries", () => ({
  recordOrphanedEntry: (...a: any[]) => mockRecordOrphan(...a),
}));

// Fire-and-forget attempt-expiry update in the guess route.
vi.mock("@/lib/supabaseClient", () => {
  const chain: any = {
    from:   () => chain,
    update: () => chain,
    eq:     () => chain,
    then:   (fn: (v: any) => any) => Promise.resolve({ data: null, error: null }).then(fn),
  };
  return { supabase: chain };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TX_HASH = "0x" + "ab".repeat(32);

function makeActiveCycle(overrides: Record<string, any> = {}) {
  return {
    id:                "cycle-db-id",
    version:           "miles",
    theme:             "bank-vault",
    status:            "active",
    pot_balance:       500,
    pot_cap:           10000,
    expires_at:        new Date(Date.now() + 1_800_000).toISOString(), // 30 min
    chain_id:          42220,
    contract_cycle_id: 12,
    contract_version:  0,
    ...overrides,
  };
}

function startRequest() {
  return new Request("http://localhost/api/crackpot/attempt/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: "miles", txHash: TX_HASH }),
  });
}

function guessRequest() {
  return new Request("http://localhost/api/crackpot/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: "attempt-1", symbols: [0, 1, 2, 3] }),
  });
}

beforeEach(() => {
  mockGetOrSync.mockReset();
  mockVerify.mockReset();
  mockCreateAttempt.mockReset();
  mockGetAttemptForPlayer.mockReset();
  mockGetCycleSecret.mockReset();
  mockRecordOrphan.mockReset();
  mockRecordOrphan.mockResolvedValue(undefined);
  mockGetCycleSecret.mockResolvedValue({
    secret: [1, 2, 3, 4],
    theme: "bank-vault",
    version: "miles",
    status: "active",
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  });
});

// ── attempt/start boundary ────────────────────────────────────────────────────

describe("POST /api/crackpot/attempt/start — entry boundary", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/crackpot/attempt/start/route"));
  });

  it("logs an orphaned entry and returns 409 when the entry landed in an earlier cycle", async () => {
    mockGetOrSync.mockResolvedValue(makeActiveCycle({ contract_cycle_id: 12 }));
    mockVerify.mockResolvedValue({
      ok: false,
      reason: "cycle_mismatch",
      txCycleId: 11n,
      entryAmount: 10n * 10n ** 18n,
      logIndex: 3,
    });

    const res = await POST(startRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("entry_cycle_rotated");
    expect(mockRecordOrphan).toHaveBeenCalledWith(expect.objectContaining({
      reason:          "cycle_rotated",
      txHash:          TX_HASH,
      playerAddress:   PLAYER,
      contractCycleId: 11,
      entryAmount:     (10n * 10n ** 18n).toString(),
    }));
    expect(mockCreateAttempt).not.toHaveBeenCalled();
  });

  it("keeps the plain 422 for a mismatch with a NEWER cycle id (not a rotation race)", async () => {
    mockGetOrSync.mockResolvedValue(makeActiveCycle({ contract_cycle_id: 12 }));
    mockVerify.mockResolvedValue({ ok: false, reason: "cycle_mismatch", txCycleId: 13n });

    const res = await POST(startRequest());

    expect(res.status).toBe(422);
    expect(mockRecordOrphan).not.toHaveBeenCalled();
  });

  it("logs an orphaned entry and returns 409 when the cycle has almost no time left", async () => {
    mockGetOrSync.mockResolvedValue(makeActiveCycle({
      expires_at: new Date(Date.now() + 8_000).toISOString(), // 8s left < 15s floor
    }));
    mockVerify.mockResolvedValue({ ok: true, logIndex: 1, cycleId: 12n, entryAmount: 10n * 10n ** 18n });

    const res = await POST(startRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("entry_too_late");
    expect(mockRecordOrphan).toHaveBeenCalledWith(expect.objectContaining({
      reason:          "entry_too_late",
      contractCycleId: 12,
    }));
    expect(mockCreateAttempt).not.toHaveBeenCalled();
  });

  it("clamps the attempt window to the cycle end when the cycle ends within 60s", async () => {
    const cycleEnd = new Date(Date.now() + 30_000); // 30s left — playable but < 60s
    mockGetOrSync.mockResolvedValue(makeActiveCycle({ expires_at: cycleEnd.toISOString() }));
    mockVerify.mockResolvedValue({ ok: true, logIndex: 1, cycleId: 12n, entryAmount: 10n * 10n ** 18n });
    mockCreateAttempt.mockResolvedValue({
      id: "attempt-1", cycle_id: "cycle-db-id", status: "active",
      expires_at: cycleEnd.toISOString(), guesses_used: 0,
    });

    const res = await POST(startRequest());

    expect(res.status).toBe(200);
    expect(mockCreateAttempt).toHaveBeenCalledWith(expect.objectContaining({
      maxExpiresAt: cycleEnd,
    }));
    expect(mockRecordOrphan).not.toHaveBeenCalled();
  });

  it("returns 503 cycle_rotating while the cycle rotates", async () => {
    mockGetOrSync.mockRejectedValue(new FakeCycleRotatingError());

    const res = await POST(startRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("cycle_rotating");
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});

// ── guess route cycle checks ──────────────────────────────────────────────────

describe("POST /api/crackpot/guess — cycle liveness", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/crackpot/guess/route"));
    mockGetAttemptForPlayer.mockResolvedValue({
      id: "attempt-1",
      cycle_id: "cycle-db-id",
      player_address: PLAYER,
      status: "active",
      expires_at: new Date(Date.now() + 45_000).toISOString(),
    });
  });

  it("returns 409 cycle_not_active when the cycle is settling", async () => {
    mockGetCycleSecret.mockResolvedValue({
      secret: [1, 2, 3, 4], theme: "bank-vault", version: "miles",
      status: "settling",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    const res = await POST(guessRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("cycle_not_active");
    expect(body.status).toBe("settling");
  });

  it("returns 410 cycle_expired when the cycle end has passed", async () => {
    mockGetCycleSecret.mockResolvedValue({
      secret: [1, 2, 3, 4], theme: "bank-vault", version: "miles",
      status: "active",
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
    });

    const res = await POST(guessRequest());
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toBe("cycle_expired");
  });
});
