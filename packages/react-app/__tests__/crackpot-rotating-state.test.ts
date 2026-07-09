/**
 * CrackPot rotating-state contract — unit tests.
 *
 * Coverage:
 *   1. /api/crackpot/cycle/current returns HTTP 200 { status: "rotating" }
 *      while the cycle rotates (no fallback row) — not a 503.
 *   2. A live fallback DB row is preferred over the rotating payload.
 *   3. Non-rotation failures still return 503 cycle_unavailable.
 *   4. /api/crackpot/attempt/current restores from the DB only:
 *      no live DB cycle → { attempt: null }; live cycle → attempt view.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared state for hoisted mocks ────────────────────────────────────────────

const state = vi.hoisted(() => ({
  fallbackRow: null as any,
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// Fallback query in cycle/current reads supabase directly.
vi.mock("@/lib/supabaseClient", () => {
  const chain: any = {
    from:        () => chain,
    select:      () => chain,
    eq:          () => chain,
    in:          () => chain,
    gt:          () => chain,
    order:       () => chain,
    limit:       () => chain,
    maybeSingle: () => Promise.resolve({ data: state.fallbackRow, error: null }),
  };
  return { supabase: chain };
});

const mockFindLiveDbCycle        = vi.fn<(...a: any[]) => Promise<any>>();
const mockGetActiveAttempt       = vi.fn<(...a: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotAttemptHelpers", () => ({
  findLiveDbCycle:          (...a: any[]) => mockFindLiveDbCycle(...a),
  getActiveAttemptForPlayer:(...a: any[]) => mockGetActiveAttempt(...a),
  getGuessesForAttempt:     vi.fn().mockResolvedValue([]),
  getGuessesForCycle:       vi.fn().mockResolvedValue([]),
  countAttemptsForPlayer:   vi.fn().mockResolvedValue({ total: 1, free: 0 }),
  buildAttemptView:         vi.fn().mockReturnValue({ attemptId: "attempt-1", status: "active" }),
  getCycleSecret:           vi.fn().mockResolvedValue({
    secret: [1, 2, 3, 4], theme: "bank-vault", version: "miles",
    status: "active", expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDbCycleRow() {
  return {
    id:                "cycle-db-id",
    version:           "miles",
    theme:             "bank-vault",
    status:            "settling",
    pot_balance:       300,
    pot_cap:           10000,
    seed_amount:       200,
    expires_at:        new Date(Date.now() + 600_000).toISOString(),
    winner_address:    null,
    winner_guesses:    null,
    created_at:        new Date().toISOString(),
    secret_commitment: "0x" + "ab".repeat(32),
  };
}

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errSpy  = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockGetOrSync.mockReset();
  mockFindLiveDbCycle.mockReset();
  mockGetActiveAttempt.mockReset();
  state.fallbackRow = null;
});

afterEach(() => {
  // Restore only the console spies — vi.restoreAllMocks() would also wipe the
  // implementations defined inside the vi.mock factories above.
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

// ── cycle/current ─────────────────────────────────────────────────────────────

describe("GET /api/crackpot/cycle/current — rotating state", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ GET } = await import("@/app/api/crackpot/cycle/current/route"));
  });

  it("returns 200 status:rotating while the cycle rotates and no fallback exists", async () => {
    mockGetOrSync.mockRejectedValue(new FakeCycleRotatingError());

    const res = await GET(new Request("http://localhost/api/crackpot/cycle/current?version=miles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("rotating");
    expect(body.version).toBe("miles");
    expect(body.retryAfterSeconds).toBe(5);
  });

  it("prefers a live fallback DB row over the rotating payload", async () => {
    mockGetOrSync.mockRejectedValue(new FakeCycleRotatingError());
    state.fallbackRow = makeDbCycleRow();

    const res = await GET(new Request("http://localhost/api/crackpot/cycle/current?version=miles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("settling");
    expect(body.cycleId).toBe("cycle-db-id");
    expect(res.headers.get("x-crackpot-sync")).toBe("fallback");
  });

  it("still returns 503 cycle_unavailable for non-rotation failures", async () => {
    mockGetOrSync.mockRejectedValue(new Error("rpc exploded"));

    const res = await GET(new Request("http://localhost/api/crackpot/cycle/current?version=miles"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("cycle_unavailable");
  });
});

// ── attempt/current ───────────────────────────────────────────────────────────

describe("GET /api/crackpot/attempt/current — DB-only restore", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ GET } = await import("@/app/api/crackpot/attempt/current/route"));
  });

  it("returns attempt:null when no live DB cycle exists (rotation window)", async () => {
    mockFindLiveDbCycle.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/crackpot/attempt/current?version=miles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attempt).toBeNull();
    expect(mockGetActiveAttempt).not.toHaveBeenCalled();
  });

  it("restores the active attempt from the live DB cycle without chain sync", async () => {
    mockFindLiveDbCycle.mockResolvedValue({
      id: "cycle-db-id", theme: "bank-vault",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    mockGetActiveAttempt.mockResolvedValue({
      id: "attempt-1", cycle_id: "cycle-db-id", status: "active",
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    });

    const res = await GET(new Request("http://localhost/api/crackpot/attempt/current?version=miles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attempt).toMatchObject({ attemptId: "attempt-1", status: "active" });
    // Chain-backed sync must never run on the restore path.
    expect(mockGetOrSync).not.toHaveBeenCalled();
  });

  it("returns attempt:null when the player has no active attempt", async () => {
    mockFindLiveDbCycle.mockResolvedValue({
      id: "cycle-db-id", theme: "bank-vault",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    mockGetActiveAttempt.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/crackpot/attempt/current?version=miles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attempt).toBeNull();
  });
});
