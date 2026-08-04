/**
 * Unit tests for creditReferralReward (referral-system-spec.md §7 adapter).
 * Same mocked-fetch shape as internal-events.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_API_KEY = "test-key";

const { creditReferralReward, reverseReferralReward } = await import("@/lib/akiba/referral-rewards");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const job = {
  idempotencyKey: "hub-referral:1:ref-123:signup:referrer",
  hubUserId: "user-123",
  identities: [{ type: "email" as const, value: "a@b.com" }],
  amountMiles: 50,
  milestone: "signup" as const,
  programVersion: 1,
  referralId: "ref-123",
};

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("creditReferralReward", () => {
  it("posts to /api/v1/referrals/reward with the Platform contract", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ ok: true, duplicate: false, ledgerReference: "ledger-1", amountMiles: 50 })
    );

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.ledgerReference).toBe("ledger-1");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://platform.test/api/v1/referrals/reward");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((options.headers as Record<string, string>)["Idempotency-Key"]).toBe(job.idempotencyKey);

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      idempotencyKey: job.idempotencyKey,
      recipient: { hubUserId: job.hubUserId, identities: job.identities },
      amountMiles: 50,
      reason: "referral_signup",
      sourceApp: "hub",
      metadata: { programVersion: 1, referralId: "ref-123", milestone: "signup" },
    });
  });

  it("uses referral_activation as the reason for the activation milestone", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ ok: true, duplicate: false, ledgerReference: "ledger-2", amountMiles: 100 })
    );

    await creditReferralReward({ ...job, milestone: "activation", amountMiles: 100 });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.reason).toBe("referral_activation");
  });

  it("returns ok:false, retryable when Platform is not configured", async () => {
    const prevUrl = process.env.AKIBA_API_URL;
    process.env.AKIBA_API_URL = "";

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.retryable).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();

    process.env.AKIBA_API_URL = prevUrl;
  });

  it("treats a 5xx response as retryable", async () => {
    mockFetch.mockResolvedValueOnce(new Response("boom", { status: 503 }));

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.retryable).toBe(true);
  });

  it("treats a 4xx response as non-retryable (operator failure, not infinite retry)", async () => {
    mockFetch.mockResolvedValueOnce(new Response("bad creds", { status: 401 }));

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.retryable).toBe(false);
  });

  it("returns ok:false when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(false);
  });

  it("rejects a response whose credited amount doesn't match the request, non-retryable", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ ok: true, duplicate: false, ledgerReference: "ledger-3", amountMiles: 999 })
    );

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.retryable).toBe(false);
  });

  it("surfaces Platform's structured error code when present", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: "conflicting identities", code: "IDENTITY_CONFLICT" }, 409));

    const result = await creditReferralReward(job);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.code).toBe("IDENTITY_CONFLICT");
    expect(result.error).toBe("conflicting identities");
    expect(result.retryable).toBe(false);
  });
});

const reversalJob = {
  idempotencyKey: "hub-referral:1:ref-123:activation:referrer:reversal",
  ledgerReference: "ledger-original-1",
  reason: "chargeback",
  metadata: { referralId: "ref-123", milestone: "activation" as const },
  expectedAmountMiles: 100,
};

describe("reverseReferralReward", () => {
  it("posts to /api/v1/referrals/reward/reverse with the Platform contract", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ ok: true, duplicate: false, ledgerReference: "ledger-debit-1", amountMiles: 100, originalLedgerReference: "ledger-original-1" })
    );

    const result = await reverseReferralReward(reversalJob);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.ledgerReference).toBe("ledger-debit-1");
    expect(result.originalLedgerReference).toBe("ledger-original-1");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://platform.test/api/v1/referrals/reward/reverse");
    expect((options.headers as Record<string, string>)["Idempotency-Key"]).toBe(reversalJob.idempotencyKey);

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      idempotencyKey: reversalJob.idempotencyKey,
      ledgerReference: reversalJob.ledgerReference,
      reason: reversalJob.reason,
      metadata: reversalJob.metadata,
    });
  });

  it("treats ALREADY_REVERSED as non-retryable even though it's a 409", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: "already reversed", code: "ALREADY_REVERSED" }, 409));

    const result = await reverseReferralReward(reversalJob);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.code).toBe("ALREADY_REVERSED");
    expect(result.retryable).toBe(false);
  });

  it("treats LEDGER_REFERENCE_NOT_FOUND (404) as non-retryable", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: "not found", code: "LEDGER_REFERENCE_NOT_FOUND" }, 404));

    const result = await reverseReferralReward(reversalJob);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.retryable).toBe(false);
  });

  it("treats a 5xx response as retryable", async () => {
    mockFetch.mockResolvedValueOnce(new Response("boom", { status: 503 }));

    const result = await reverseReferralReward(reversalJob);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.retryable).toBe(true);
  });

  it("rejects a reversed amount that doesn't match what was expected, non-retryable", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ ok: true, duplicate: false, ledgerReference: "ledger-debit-2", amountMiles: 999, originalLedgerReference: "ledger-original-1" })
    );

    const result = await reverseReferralReward(reversalJob);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.code).toBe("amount_mismatch");
    expect(result.retryable).toBe(false);
  });

  it("returns ok:false when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await reverseReferralReward(reversalJob);

    expect(result.ok).toBe(false);
  });
});
