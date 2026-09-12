import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockGetIntentById = vi.fn();
const mockGetIntentForDay = vi.fn();
const mockMarkIntentSubmitted = vi.fn();
const mockReconcileIntent = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
}));

vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-daily", points: 10, reason: "daily-engagement:quest-daily" }),
}));

// Fixed "now" one second past UTC midnight — the intent below was issued the
// day before, simulating a transaction that was broadcast just before
// midnight and only confirms after it rolls over.
vi.mock("@/lib/dailyQuestClaimer", () => ({
  getUtcDayContext: () => ({ claimDate: "2026-09-13", dayNonce: 20709n, deadline: 1789343999n }),
}));

vi.mock("@/lib/server/dailyClaimIntents", () => ({
  getIntentById: (...args: any[]) => mockGetIntentById(...args),
  getIntentForDay: (...args: any[]) => mockGetIntentForDay(...args),
  markIntentSubmitted: (...args: any[]) => mockMarkIntentSubmitted(...args),
  reconcileIntent: (...args: any[]) => mockReconcileIntent(...args),
}));

const { POST } = await import("@/app/api/quests/daily/confirm/route");

const VALID_HASH = "0x" + "a".repeat(64);

function req(body: unknown) {
  return new Request("http://localhost/api/quests/daily/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() });
});

describe("POST /api/quests/daily/confirm", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await POST(req({ txHash: VALID_HASH }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed transaction hash", async () => {
    const res = await POST(req({ txHash: "not-a-hash" }));
    expect(res.status).toBe(400);
    expect(mockGetIntentById).not.toHaveBeenCalled();
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
  });

  it("rejects a non-string intentId instead of falling back to today's intent", async () => {
    const res = await POST(req({ txHash: VALID_HASH, intentId: 123 }));
    expect(res.status).toBe(400);
    expect(mockGetIntentById).not.toHaveBeenCalled();
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
  });

  it("treats an explicitly supplied empty intentId as invalid rather than absent", async () => {
    mockGetIntentById.mockResolvedValue(null);
    const res = await POST(req({ txHash: VALID_HASH, intentId: "" }));
    expect(res.status).toBe(404);
    expect(mockGetIntentById).toHaveBeenCalledWith("", "0xabc");
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
  });

  it("looks up the intent by id — and skips today's date lookup — when intentId is provided", async () => {
    const intent = { id: "intent-1", status: "submitted", tx_hash: VALID_HASH, points_awarded: 10, last_error: null };
    mockGetIntentById.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue({ ...intent, status: "confirmed" });

    const res = await POST(req({ txHash: VALID_HASH, intentId: "intent-1" }));
    const body = await res.json();

    expect(mockGetIntentById).toHaveBeenCalledWith("intent-1", "0xabc");
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
    expect(body).toEqual(expect.objectContaining({ success: true, status: "confirmed" }));
  });

  it("finds an intent by id even though its claim_date is not today (the UTC-midnight case)", async () => {
    // This intent was issued for 2026-09-12, but getUtcDayContext (mocked
    // above) says the server's "today" is now 2026-09-13 — a date-keyed
    // lookup would 404 here. Confirming by intentId must still work.
    const intent = {
      id: "intent-yesterday",
      user_address: "0xabc",
      quest_id: "quest-daily",
      claim_date: "2026-09-12",
      status: "issued",
      tx_hash: null,
      points_awarded: 10,
      last_error: null,
    };
    mockGetIntentById.mockResolvedValue(intent);
    mockMarkIntentSubmitted.mockResolvedValue({ ...intent, status: "submitted", tx_hash: VALID_HASH });
    mockReconcileIntent.mockResolvedValue({ ...intent, status: "confirmed", tx_hash: VALID_HASH });

    const res = await POST(req({ txHash: VALID_HASH, intentId: "intent-yesterday" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe("confirmed");
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
  });

  it("falls back to today's date lookup when no intentId is supplied (older clients)", async () => {
    mockGetIntentById.mockResolvedValue(null);
    const intent = { id: "intent-2", status: "issued", tx_hash: null, points_awarded: 10, last_error: null };
    mockGetIntentForDay.mockResolvedValue(intent);
    mockMarkIntentSubmitted.mockResolvedValue({ ...intent, status: "submitted", tx_hash: VALID_HASH });
    mockReconcileIntent.mockResolvedValue({ ...intent, status: "submitted", tx_hash: VALID_HASH });

    const res = await POST(req({ txHash: VALID_HASH }));
    const body = await res.json();

    expect(mockGetIntentForDay).toHaveBeenCalledWith("0xabc", "quest-daily", "2026-09-13");
    expect(body).toEqual(expect.objectContaining({ success: true, status: "submitted" }));
  });

  it("returns 404 when neither an intentId nor today's date resolves an intent", async () => {
    mockGetIntentById.mockResolvedValue(null);
    mockGetIntentForDay.mockResolvedValue(null);

    const res = await POST(req({ txHash: VALID_HASH, intentId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("does not let one wallet confirm using another wallet's intentId", async () => {
    // getIntentById is responsible for the ownership check and returns null
    // for a mismatched wallet — the route must not then guess via date.
    mockGetIntentById.mockResolvedValue(null);
    mockGetIntentForDay.mockResolvedValue(null);

    const res = await POST(req({ txHash: VALID_HASH, intentId: "someone-elses-intent" }));
    expect(mockGetIntentById).toHaveBeenCalledWith("someone-elses-intent", "0xabc");
    expect(res.status).toBe(404);
  });

  it("fails closed rather than silently substituting today's intent when a supplied intentId doesn't resolve", async () => {
    mockGetIntentById.mockResolvedValue(null);
    // Deliberately makes the date fallback "succeed" with a real, different
    // intent — if the route incorrectly fell through to it, this hash would
    // get associated with the wrong claim instead of 404ing.
    const wrongIntent = { id: "todays-intent", status: "issued", tx_hash: null, points_awarded: 10, last_error: null };
    mockGetIntentForDay.mockResolvedValue(wrongIntent);

    const res = await POST(req({ txHash: VALID_HASH, intentId: "stale-or-foreign-id" }));

    expect(res.status).toBe(404);
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
    expect(mockMarkIntentSubmitted).not.toHaveBeenCalled();
    expect(mockReconcileIntent).not.toHaveBeenCalled();
  });

  it("reports a genuine revert as a retryable failure, not a silent success", async () => {
    const intent = { id: "intent-3", status: "submitted", tx_hash: VALID_HASH, points_awarded: 10, last_error: null };
    mockGetIntentById.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue({
      ...intent,
      status: "issued",
      tx_hash: null,
      last_error: "Transaction reverted on-chain.",
    });

    const res = await POST(req({ txHash: VALID_HASH, intentId: "intent-3" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.code).toBe("reverted");
    expect(body.message).toMatch(/reverted/i);
  });
});
