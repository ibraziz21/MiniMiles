import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockGetIntentById = vi.fn();
const mockGetIntentForDay = vi.fn();
const mockReconcileIntent = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
}));

vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-daily", points: 10, reason: "daily-engagement:quest-daily" }),
}));

vi.mock("@/lib/dailyQuestClaimer", () => ({
  getUtcDayContext: () => ({ claimDate: "2026-09-13", dayNonce: 20709n, deadline: 1789343999n }),
}));

vi.mock("@/lib/server/dailyClaimIntents", () => ({
  getIntentById: (...args: any[]) => mockGetIntentById(...args),
  getIntentForDay: (...args: any[]) => mockGetIntentForDay(...args),
  reconcileIntent: (...args: any[]) => mockReconcileIntent(...args),
}));

const { GET } = await import("@/app/api/quests/daily/claim-status/route");

const VALID_HASH = "0x" + "b".repeat(64);

function req(query: string) {
  return new Request(`http://localhost/api/quests/daily/claim-status${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() });
});

describe("GET /api/quests/daily/claim-status", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await GET(req(""));
    expect(res.status).toBe(401);
  });

  it("reports exists:false when there is no intent to look up", async () => {
    mockGetIntentForDay.mockResolvedValue(null);
    const res = await GET(req(""));
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: true, status: "issued", exists: false }));
    expect(mockReconcileIntent).not.toHaveBeenCalled();
  });

  it("looks up by intentId even when the intent's claim_date is not today (UTC-midnight case)", async () => {
    const intent = { id: "intent-yesterday", claim_date: "2026-09-12", status: "submitted", tx_hash: VALID_HASH };
    mockGetIntentById.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue({ ...intent, status: "confirmed", points_awarded: 10 });

    const res = await GET(req(`?intentId=intent-yesterday`));
    const body = await res.json();

    expect(mockGetIntentById).toHaveBeenCalledWith("intent-yesterday", "0xabc");
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
    expect(body.status).toBe("confirmed");
  });

  it("forwards the txHash query param as a reconciliation hint (self-heals if POST /confirm never landed)", async () => {
    const intent = { id: "intent-1", claim_date: "2026-09-13", status: "issued", tx_hash: null };
    mockGetIntentById.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue({ ...intent, status: "confirmed", points_awarded: 10 });

    await GET(req(`?intentId=intent-1&txHash=${VALID_HASH}`));

    expect(mockReconcileIntent).toHaveBeenCalledWith(intent, { incomingTxHash: VALID_HASH });
  });

  it("does not pass an incomingTxHash hint when none was supplied", async () => {
    const intent = { id: "intent-1", claim_date: "2026-09-13", status: "submitted", tx_hash: VALID_HASH };
    mockGetIntentById.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue(intent);

    await GET(req(`?intentId=intent-1`));

    expect(mockReconcileIntent).toHaveBeenCalledWith(intent, undefined);
  });

  it("falls back to today's date lookup when no intentId is supplied", async () => {
    mockGetIntentById.mockResolvedValue(null);
    const intent = { id: "intent-2", claim_date: "2026-09-13", status: "issued", tx_hash: null };
    mockGetIntentForDay.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue(intent);

    const res = await GET(req(""));
    expect(mockGetIntentForDay).toHaveBeenCalledWith("0xabc", "quest-daily", "2026-09-13");
    expect(res.status).toBe(200);
  });

  it("fails closed (exists:false) rather than silently substituting today's intent when a supplied intentId doesn't resolve", async () => {
    mockGetIntentById.mockResolvedValue(null);
    // Deliberately makes the date fallback "succeed" with a real, different
    // intent — if the route incorrectly fell through to it, status would
    // reflect the wrong claim instead of reporting no match.
    const wrongIntent = { id: "todays-intent", claim_date: "2026-09-13", status: "confirmed", points_awarded: 999 };
    mockGetIntentForDay.mockResolvedValue(wrongIntent);

    const res = await GET(req(`?intentId=stale-or-foreign-id`));
    const body = await res.json();

    expect(body).toEqual(expect.objectContaining({ success: true, status: "issued", exists: false }));
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
    expect(mockReconcileIntent).not.toHaveBeenCalled();
  });

  it("treats an explicitly supplied empty intentId as invalid rather than absent", async () => {
    mockGetIntentById.mockResolvedValue(null);
    const res = await GET(req("?intentId="));
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: true, status: "issued", exists: false }));
    expect(mockGetIntentById).toHaveBeenCalledWith("", "0xabc");
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
  });

  it("rejects an explicitly supplied empty txHash rather than treating it as absent", async () => {
    const res = await GET(req("?txHash="));
    expect(res.status).toBe(400);
    expect(mockGetIntentById).not.toHaveBeenCalled();
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
  });

  it("rejects a malformed txHash hint instead of writing it onto the intent", async () => {
    const res = await GET(req(`?intentId=intent-1&txHash=not-a-hash`));
    expect(res.status).toBe(400);
    expect(mockGetIntentById).not.toHaveBeenCalled();
    expect(mockGetIntentForDay).not.toHaveBeenCalled();
    expect(mockReconcileIntent).not.toHaveBeenCalled();
  });
});
