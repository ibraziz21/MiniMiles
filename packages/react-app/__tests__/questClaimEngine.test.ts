import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";

const mockRequireSession = vi.fn();
const mockIsSelfClaimEnabledForWallet = vi.fn();
const mockCheckDailyVoucherRateLimit = vi.fn();
const mockValidateDailyClaimConfig = vi.fn();
const mockIsClaimedOnchain = vi.fn();
const mockGetIntentForScope = vi.fn();
const mockCreateGenericIntent = vi.fn();
const mockReconcileIntent = vi.fn();
const mockSweepStaleClaimIntents = vi.fn();
const mockComputeQuestReward = vi.fn();
const mockSignDailyClaimVoucher = vi.fn();
const mockCheckLegacyMintJobConflict = vi.fn();
const mockGetIntentById = vi.fn();
const mockMarkIntentSubmitted = vi.fn();
const mockGetPendingIntentsForWallet = vi.fn();
const mockRefreshIntentDeadline = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
  logSessionAge: () => true,
}));

vi.mock("@/lib/server/dailySelfClaimMode", () => ({
  isSelfClaimEnabledForWallet: (...a: any[]) => mockIsSelfClaimEnabledForWallet(...a),
}));

vi.mock("@/lib/server/dailyVoucherRateLimit", () => ({
  checkDailyVoucherRateLimit: (...a: any[]) => mockCheckDailyVoucherRateLimit(...a),
  getClientIp: () => "203.0.113.5",
}));

vi.mock("@/lib/server/dailyClaimConfig", () => ({
  validateDailyClaimConfig: () => mockValidateDailyClaimConfig(),
}));

vi.mock("@/lib/server/dailyClaimSigner", () => ({
  signDailyClaimVoucher: (...a: any[]) => mockSignDailyClaimVoucher(...a),
}));

vi.mock("@/lib/server/questReward", () => ({
  computeQuestReward: (...a: any[]) => mockComputeQuestReward(...a),
}));

vi.mock("@/lib/server/legacyMintJobGuard", () => ({
  checkLegacyMintJobConflict: (...a: any[]) => mockCheckLegacyMintJobConflict(...a),
  legacyDailyIdempotencyKey: (questId: string, addr: string, scope: string) => `daily:${questId}:${addr}:${scope}`,
}));

vi.mock("@/lib/dailyQuestClaimer", () => ({
  pointsToAmountWei: (points: number) => BigInt(points) * 10n ** 18n,
  deadlineForScope: (scope: string) => (scope === "instance" ? 1789260000n : 1789257599n),
}));

vi.mock("@/lib/server/dailyClaimIntents", () => ({
  isClaimedOnchain: (...a: any[]) => mockIsClaimedOnchain(...a),
  getIntentForScope: (...a: any[]) => mockGetIntentForScope(...a),
  createGenericIntent: (...a: any[]) => mockCreateGenericIntent(...a),
  reconcileIntent: (...a: any[]) => mockReconcileIntent(...a),
  sweepStaleClaimIntents: (...a: any[]) => mockSweepStaleClaimIntents(...a),
  getIntentById: (...a: any[]) => mockGetIntentById(...a),
  markIntentSubmitted: (...a: any[]) => mockMarkIntentSubmitted(...a),
  getPendingIntentsForWallet: (...a: any[]) => mockGetPendingIntentsForWallet(...a),
  refreshIntentDeadline: (...a: any[]) => mockRefreshIntentDeadline(...a),
}));

const { issueQuestVoucher, confirmQuestClaim, getQuestClaimStatus, getPendingQuestClaims } = await import(
  "@/lib/server/questClaimEngine"
);

const CLAIMER_ADDRESS = "0xa9e6adb52e74151553c140615a09119d501c75ce";

function makeAdapter(overrides: Partial<QuestClaimAdapter> = {}): QuestClaimAdapter {
  return {
    family: "test_family",
    resolveIdentity: vi.fn().mockResolvedValue({
      questId: "quest-1",
      scopeKey: "2026-09-12",
      claimNonce: 123456789n,
      deadline: 1789257599n,
    }),
    verifyEligibility: vi.fn().mockResolvedValue({
      ok: true,
      result: { basePoints: 30, finalizerKind: "daily_engagement", finalizerPayload: { questId: "quest-1", claimDate: "2026-09-12" } },
    }),
    legacyIdempotencyKey: (identity, addr) => `daily:${identity.questId}:${addr}:${identity.scopeKey}`,
    ...overrides,
  };
}

function req() {
  return new Request("http://localhost/api/quests/test_family/voucher", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() - 120_000 });
  mockIsSelfClaimEnabledForWallet.mockReturnValue(true);
  mockCheckDailyVoucherRateLimit.mockReturnValue({ ok: true });
  mockValidateDailyClaimConfig.mockResolvedValue({ ok: true, claimerAddress: CLAIMER_ADDRESS });
  mockSweepStaleClaimIntents.mockResolvedValue(undefined);
  mockIsClaimedOnchain.mockResolvedValue(false);
  mockCheckLegacyMintJobConflict.mockResolvedValue({ conflict: false });
  mockSignDailyClaimVoucher.mockResolvedValue("0xsig");
});

describe("issueQuestVoucher", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await issueQuestVoucher(makeAdapter(), req());
    expect(res.status).toBe(401);
  });

  it("rejects wallets not yet on the self-claim path for this family", async () => {
    mockIsSelfClaimEnabledForWallet.mockReturnValue(false);
    const adapter = makeAdapter();
    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("self-claim-disabled");
    expect(mockIsSelfClaimEnabledForWallet).toHaveBeenCalledWith("test_family", "0xAbC");
  });

  it("rate-limits before ever calling the adapter", async () => {
    mockCheckDailyVoucherRateLimit.mockReturnValue({ ok: false, reason: "slow down" });
    const adapter = makeAdapter();
    const res = await issueQuestVoucher(adapter, req());
    expect(res.status).toBe(429);
    expect(adapter.resolveIdentity).not.toHaveBeenCalled();
  });

  it("fails closed when on-chain config validation fails", async () => {
    mockValidateDailyClaimConfig.mockResolvedValue({ ok: false, reason: "signer mismatch" });
    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("signer-not-configured");
  });

  it("sweeps stale intents for the resolved quest before touching the current scope", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    mockComputeQuestReward.mockResolvedValue({ basePoints: 30, awardedPoints: 30, vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 } });
    mockCreateGenericIntent.mockResolvedValue({
      id: "intent-1", amount_wei: (30n * 10n ** 18n).toString(), claim_nonce: "123456789", deadline: "1789257599",
      points_awarded: 30, base_points: 30, vault_boost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
      status: "issued", quest_id: "quest-1", scope_key: "2026-09-12",
    });

    await issueQuestVoucher(makeAdapter(), req());

    expect(mockSweepStaleClaimIntents).toHaveBeenCalledWith({
      userAddress: "0xabc",
      questId: "quest-1",
      beforeClaimDate: "2026-09-12",
    });
  });

  it("reports already-claimed and reconciles defensively when claimed()=true with no matching intent", async () => {
    mockIsClaimedOnchain.mockResolvedValue(true);
    mockGetIntentForScope.mockResolvedValue(null);

    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();

    expect(body).toEqual(expect.objectContaining({ success: false, code: "already" }));
    expect(mockCreateGenericIntent).not.toHaveBeenCalled();
  });

  it("reconciles the existing intent instead of recomputing when claimed()=true and an intent already exists", async () => {
    mockIsClaimedOnchain.mockResolvedValue(true);
    const existing = { id: "intent-1", status: "submitted" };
    mockGetIntentForScope.mockResolvedValue(existing);
    mockReconcileIntent.mockResolvedValue({ ...existing, status: "confirmed" });

    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();

    expect(mockReconcileIntent).toHaveBeenCalledWith(existing);
    expect(body.code).toBe("already");
  });

  it("blocks issuance while a legacy sponsored job for the same completion is still pending/processing", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    mockCheckLegacyMintJobConflict.mockResolvedValue({ conflict: true, status: "processing", jobId: "job-1" });
    const adapter = makeAdapter();

    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.code).toBe("processing");
    expect(adapter.verifyEligibility).not.toHaveBeenCalled();
    expect(mockCreateGenericIntent).not.toHaveBeenCalled();
  });

  it("reports already-claimed when a legacy sponsored job already completed the same reward", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    mockCheckLegacyMintJobConflict.mockResolvedValue({ conflict: true, status: "already", jobId: "job-1" });
    const adapter = makeAdapter();

    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();

    expect(body.code).toBe("already");
    expect(adapter.verifyEligibility).not.toHaveBeenCalled();
  });

  it("allows issuance once a legacy job has conclusively failed (no mint occurred)", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    mockCheckLegacyMintJobConflict.mockResolvedValue({ conflict: false });
    mockComputeQuestReward.mockResolvedValue({ basePoints: 30, awardedPoints: 30, vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 } });
    mockCreateGenericIntent.mockResolvedValue({
      id: "intent-1", amount_wei: (30n * 10n ** 18n).toString(), claim_nonce: "123456789", deadline: "1789257599",
      points_awarded: 30, base_points: 30, vault_boost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
      status: "issued", quest_id: "quest-1", scope_key: "2026-09-12",
    });

    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("passes through the adapter's ineligibility response verbatim", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    const adapter = makeAdapter({
      verifyEligibility: vi.fn().mockResolvedValue({ ok: false, status: 403, code: "condition-failed", message: "Not eligible yet" }),
    });

    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual(expect.objectContaining({ success: false, code: "condition-failed", message: "Not eligible yet" }));
    expect(mockCreateGenericIntent).not.toHaveBeenCalled();
  });

  it("creates a new intent, freezes the reward via computeQuestReward, and signs only the stored intent's values", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    mockComputeQuestReward.mockResolvedValue({
      basePoints: 30,
      awardedPoints: 45,
      vaultBoost: { applied: true, multiplier: 1.5, minBalanceUsdt: 0.000001 },
    });
    mockCreateGenericIntent.mockResolvedValue({
      id: "intent-new",
      amount_wei: (45n * 10n ** 18n).toString(),
      claim_nonce: "123456789",
      deadline: "1789257599",
      points_awarded: 45,
      base_points: 30,
      vault_boost: { applied: true, multiplier: 1.5, minBalanceUsdt: 0.000001 },
      status: "issued",
      quest_id: "quest-1",
      scope_key: "2026-09-12",
    });

    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();

    expect(mockCreateGenericIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        userAddress: "0xabc",
        questId: "quest-1",
        scopeKey: "2026-09-12",
        claimNonce: 123456789n,
        claimFamily: "test_family",
        awardedPoints: 45,
        finalizerKind: "daily_engagement",
      }),
    );
    expect(mockSignDailyClaimVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ user: "0xabc", amount: 45n * 10n ** 18n, dayNonce: 123456789n }),
    );
    expect(body).toEqual(
      expect.objectContaining({
        success: true,
        status: "issued",
        delivery: "self-claim",
        family: "test_family",
        intentId: "intent-new",
        signature: "0xsig",
        points: 45,
      }),
    );
  });

  it("caps an outsized reward at the shared max-points ceiling before signing", async () => {
    mockGetIntentForScope.mockResolvedValue(null);
    mockComputeQuestReward.mockResolvedValue({ basePoints: 30, awardedPoints: 100000, vaultBoost: { applied: true, multiplier: 3000, minBalanceUsdt: 0 } });
    mockCreateGenericIntent.mockImplementation((opts: any) =>
      Promise.resolve({
        id: "intent-capped", amount_wei: opts.amountWei.toString(), claim_nonce: "123456789", deadline: "1789257599",
        points_awarded: opts.awardedPoints, base_points: opts.basePoints, vault_boost: opts.vaultBoost, status: "issued",
        quest_id: "quest-1", scope_key: "2026-09-12",
      }),
    );

    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();
    expect(body.points).toBe(500); // DAILY_CLAIM_MAX_POINTS default
    expect(mockCreateGenericIntent).toHaveBeenCalledWith(expect.objectContaining({ awardedPoints: 500 }));
  });

  it("returns already-claimed without re-signing once the intent is confirmed", async () => {
    mockGetIntentForScope.mockResolvedValue({ id: "intent-1", status: "confirmed" });
    const adapter = makeAdapter();
    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();
    expect(body.code).toBe("already");
    expect(adapter.verifyEligibility).not.toHaveBeenCalled();
    expect(mockSignDailyClaimVoucher).not.toHaveBeenCalled();
  });

  it("reports submitted (without re-signing) while a previous transaction is still confirming", async () => {
    mockGetIntentForScope.mockResolvedValue({ id: "intent-2", status: "submitted", tx_hash: "0xhash" });
    mockReconcileIntent.mockResolvedValue({ id: "intent-2", status: "submitted", tx_hash: "0xhash", claim_family: "test_family", quest_id: "quest-1", scope_key: "2026-09-12" });

    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();

    expect(body).toEqual(expect.objectContaining({ success: false, code: "submitted", intentId: "intent-2", txHash: "0xhash" }));
    expect(mockSignDailyClaimVoucher).not.toHaveBeenCalled();
  });

  it("reports expired without offering a voucher once the scope has closed", async () => {
    mockGetIntentForScope.mockResolvedValue({ id: "intent-3", status: "expired" });
    const res = await issueQuestVoucher(makeAdapter(), req());
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: false, code: "expired" }));
    expect(mockSignDailyClaimVoucher).not.toHaveBeenCalled();
  });

  it("refreshes an expired instance-scoped intent's deadline and signs, instead of reporting expired", async () => {
    const expiredIntent = {
      id: "intent-instance", status: "expired", tx_hash: null,
      amount_wei: (30n * 10n ** 18n).toString(), claim_nonce: "999", deadline: "1000",
      points_awarded: 30, quest_id: "quest-1", scope_key: "streak:2026-09-06:2026-09-12",
    };
    mockGetIntentForScope.mockResolvedValue(expiredIntent);
    mockRefreshIntentDeadline.mockResolvedValue({ ...expiredIntent, status: "issued", deadline: "1789260000" });

    const adapter = makeAdapter({ canRefreshDeadline: true });
    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();

    expect(mockRefreshIntentDeadline).toHaveBeenCalledWith(expiredIntent, 1789260000n);
    expect(body.success).toBe(true);
    expect(body.deadline).toBe("1789260000");
    expect(mockSignDailyClaimVoucher).toHaveBeenCalledWith(expect.objectContaining({ deadline: 1789260000n }));
  });

  it("proactively refreshes a reused 'issued' instance intent whose deadline already lapsed", async () => {
    // Never got as far as "expired" (reconcileIntent was never called on it),
    // but its 15-minute signature window has already passed — must not sign
    // a voucher that would revert on-chain as Expired.
    const staleIssued = {
      id: "intent-instance", status: "issued", tx_hash: null,
      amount_wei: (30n * 10n ** 18n).toString(), claim_nonce: "999",
      deadline: String(Math.floor(Date.now() / 1000) - 60),
      points_awarded: 30, quest_id: "quest-1", scope_key: "streak:2026-09-06:2026-09-12",
    };
    mockGetIntentForScope.mockResolvedValue(staleIssued);
    mockRefreshIntentDeadline.mockResolvedValue({ ...staleIssued, deadline: "1789260000" });

    const adapter = makeAdapter({ canRefreshDeadline: true });
    const res = await issueQuestVoucher(adapter, req());
    const body = await res.json();

    expect(mockRefreshIntentDeadline).toHaveBeenCalledWith(staleIssued, 1789260000n);
    expect(body.success).toBe(true);
  });

  it("does not touch the deadline of a fresh, still-open 'issued' intent", async () => {
    const freshIssued = {
      id: "intent-1", status: "issued", tx_hash: null,
      amount_wei: (30n * 10n ** 18n).toString(), claim_nonce: "999",
      deadline: String(Math.floor(Date.now() / 1000) + 600),
      points_awarded: 30, quest_id: "quest-1", scope_key: "2026-09-12",
    };
    mockGetIntentForScope.mockResolvedValue(freshIssued);

    const adapter = makeAdapter({ canRefreshDeadline: true });
    await issueQuestVoucher(adapter, req());

    expect(mockRefreshIntentDeadline).not.toHaveBeenCalled();
  });
});

describe("confirmQuestClaim", () => {
  function confirmReq(body: unknown) {
    return new Request("http://localhost/api/quests/self-claim/confirm", { method: "POST", body: JSON.stringify(body) });
  }

  beforeEach(() => {
    mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() });
  });

  it("requires intentId — the generic endpoint has no date-based fallback", async () => {
    const res = await confirmQuestClaim(confirmReq({ txHash: "0x" + "a".repeat(64) }));
    expect(res.status).toBe(400);
  });

  it("fails closed on an unresolved intentId", async () => {
    mockGetIntentById.mockResolvedValue(null);
    const res = await confirmQuestClaim(confirmReq({ txHash: "0x" + "a".repeat(64), intentId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("confirms via the shared reconciliation logic regardless of family", async () => {
    const intent = { id: "intent-1", status: "submitted", tx_hash: "0x" + "a".repeat(64), claim_family: "daily_transfer", points_awarded: 30 };
    mockGetIntentById.mockResolvedValue(intent);
    mockReconcileIntent.mockResolvedValue({ ...intent, status: "confirmed" });

    const res = await confirmQuestClaim(confirmReq({ txHash: intent.tx_hash, intentId: "intent-1" }));
    const body = await res.json();

    expect(body).toEqual(expect.objectContaining({ success: true, status: "confirmed", family: "daily_transfer" }));
  });
});

describe("getQuestClaimStatus", () => {
  function statusReq(query: string) {
    return new Request(`http://localhost/api/quests/self-claim/status${query}`);
  }

  beforeEach(() => {
    mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() });
  });

  it("requires intentId", async () => {
    const res = await getQuestClaimStatus(statusReq(""));
    expect(res.status).toBe(400);
  });

  it("validates the optional txHash hint", async () => {
    const res = await getQuestClaimStatus(statusReq("?intentId=intent-1&txHash=not-a-hash"));
    expect(res.status).toBe(400);
    expect(mockGetIntentById).not.toHaveBeenCalled();
  });

  it("reports exists:false for an unresolved intentId", async () => {
    mockGetIntentById.mockResolvedValue(null);
    const res = await getQuestClaimStatus(statusReq("?intentId=nope"));
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: true, exists: false }));
  });
});

describe("getPendingQuestClaims", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await getPendingQuestClaims(new Request("http://localhost/api/quests/self-claim/pending"));
    expect(res.status).toBe(401);
  });

  it("returns the wallet's bounded nonterminal intents across every family", async () => {
    mockRequireSession.mockResolvedValue({ walletAddress: "0xAbC", issuedAt: Date.now() });
    mockGetPendingIntentsForWallet.mockResolvedValue([
      { id: "i1", claim_family: "daily_checkin", quest_id: "q1", scope_key: "2026-09-12", status: "submitted", points_awarded: 10, tx_hash: "0xabc", deadline: "1" },
      { id: "i2", claim_family: "daily_transfer", quest_id: "q2", scope_key: "2026-09-12", status: "issued", points_awarded: 30, tx_hash: null, deadline: "1" },
    ]);

    const res = await getPendingQuestClaims(new Request("http://localhost/api/quests/self-claim/pending"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.intents).toHaveLength(2);
    expect(body.intents[0]).toEqual(expect.objectContaining({ intentId: "i1", family: "daily_checkin" }));
  });
});
