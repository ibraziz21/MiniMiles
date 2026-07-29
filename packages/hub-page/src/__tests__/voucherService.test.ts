import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data: unknown; error: any; count?: number };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = () => (typeof result === "function" ? result() : result);
  const chain: Record<string, any> = {};
  for (const method of [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "gt", "lt", "gte", "in", "or", "limit", "order", "not",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(resolve()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolve()));
  chain.then = (resolvePromise: (value: unknown) => unknown) =>
    Promise.resolve(resolve()).then(resolvePromise);
  return chain;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockReadChainBalanceStrict = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

vi.mock("@/lib/akiba/balance", () => ({
  readChainBalanceStrict: (...args: unknown[]) => mockReadChainBalanceStrict(...args),
}));

vi.stubGlobal("crypto", {
  randomUUID: () => "generated-uuid",
  getRandomValues: (array: Uint8Array) => {
    for (let index = 0; index < array.length; index += 1) array[index] = index % 32;
    return array;
  },
});

const VALID_INPUT = {
  userId: "hub-user-uuid",
  userAddress: "0xabcd",
  email: "user@example.com",
  templateId: "tmpl-uuid",
  merchantId: "merch-uuid",
  nonce: "unique-nonce-1",
  idempotencyKey: "purchase-key-1",
  consentMethod: "wallet_signature" as const,
  disclosureVersion: "wallet-signature-v1",
  totalPoints: 100,
};

function purchaseRow(overrides: Record<string, unknown> = {}) {
  return [{
    intent_id: "intent-uuid",
    voucher_id: "voucher-uuid",
    code: "TESTCODE12",
    ledger_points: 100,
    onchain_points: 0,
    state: "finalized",
    failure_code: null,
    ...overrides,
  }];
}

function configureIssuanceTables(options: {
  wallets?: Array<{ address: string }>;
  nonceError?: any;
  walletsError?: any;
} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "voucher_issue_nonces") {
      return makeChain({ data: null, error: options.nonceError ?? null });
    }
    if (table === "hub_user_wallets") {
      return makeChain({
        data: options.wallets ?? [{ address: "0xabcd" }],
        error: options.walletsError ?? null,
      });
    }
    return makeChain({ data: null, error: null });
  });
}

async function getIssueVoucher() {
  vi.resetModules();
  return (await import("@/lib/vouchers/issuance")).issueVoucher;
}

describe("voucher helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("generates secure codes without Math.random", async () => {
    const mathSpy = vi.spyOn(Math, "random");
    const { generateSecureCode } = await import("@/lib/vouchers/codes");
    expect(generateSecureCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    expect(mathSpy).not.toHaveBeenCalled();
    mathSpy.mockRestore();
  });

  it("rejects stale signed timestamps", async () => {
    const { isTimestampFresh } = await import("@/lib/vouchers/codes");
    expect(isTimestampFresh(Math.floor(Date.now() / 1000) - 700)).toBe(false);
  });
});

describe("issueVoucher – canonical spend intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    configureIssuanceTables();
    mockReadChainBalanceStrict.mockResolvedValue({ ok: true, balance: 500 });
  });

  it("returns an issued voucher for a ledger-only finalization", async () => {
    mockRpc.mockResolvedValue({ data: purchaseRow(), error: null });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher(VALID_INPUT);

    expect(result).toEqual({
      ok: true,
      voucher: { id: "voucher-uuid", code: "TESTCODE12", status: "issued" },
      intentState: "finalized",
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_voucher_purchase",
      expect.objectContaining({
        p_hub_user_id: VALID_INPUT.userId,
        p_idempotency_key: VALID_INPUT.idempotencyKey,
        p_disclosure_version: "wallet-signature-v1",
        p_onchain_balance_ok: true,
      }),
    );
  });

  it("supports a walletless ledger-only purchase without consuming a wallet nonce", async () => {
    configureIssuanceTables({ wallets: [] });
    mockRpc.mockResolvedValue({ data: purchaseRow(), error: null });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher({
      ...VALID_INPUT,
      userAddress: null,
      nonce: undefined,
      consentMethod: "hub_ui_confirmed",
      disclosureVersion: "v1",
      quoteId: "quote-uuid",
    });

    expect(result.ok).toBe(true);
    expect(mockReadChainBalanceStrict).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("voucher_issue_nonces");
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_voucher_purchase",
      expect.objectContaining({
        p_wallet_address: null,
        p_onchain_balance: 0,
      }),
    );
  });

  it("returns queued for a split or on-chain purchase", async () => {
    mockRpc.mockResolvedValue({
      data: purchaseRow({
        ledger_points: 40,
        onchain_points: 60,
        state: "reserved",
      }),
      error: null,
    });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher(VALID_INPUT);

    expect(result).toEqual({
      ok: true,
      voucher: { id: "voucher-uuid", code: "TESTCODE12", status: "pending" },
      queued: true,
      intentState: "reserved",
    });
  });

  it("returns the stored failure instead of replaying it as queued", async () => {
    mockRpc.mockResolvedValue({
      data: purchaseRow({
        state: "failed",
        failure_code: "RESERVATION_EXPIRED",
      }),
      error: null,
    });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
      expect(result.error).toMatch(/expired/i);
    }
  });

  it.each([
    ["CAP_EXCEEDED", 409],
    ["COOLDOWN_ACTIVE", 429],
    ["IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD", 409],
    ["QUOTE_STALE", 409],
    ["BALANCE_UNAVAILABLE", 503],
    ["WALLET_REQUIRED_FOR_ONCHAIN_PORTION", 400],
    ["INSUFFICIENT_BALANCE", 422],
  ])("maps %s to HTTP %i", async (message, expectedStatus) => {
    mockRpc.mockResolvedValue({ data: null, error: { message } });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(expectedStatus);
  });

  it("rejects a replayed signed nonce before reserving", async () => {
    configureIssuanceTables({ nonceError: { code: "23505", message: "duplicate" } });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails closed when linked wallets cannot be resolved", async () => {
    configureIssuanceTables({ walletsError: { message: "database unavailable" } });
    const issueVoucher = await getIssueVoucher();

    const result = await issueVoucher(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

const CLAIM_PARAMS = {
  voucherId: "voucher-uuid",
  hubUserId: "hub-user-uuid",
  userAddresses: ["0xabcd"],
  merchantId: "merch-uuid",
};

const FINALISE_PARAMS = {
  voucherId: "voucher-uuid",
  hubUserId: "hub-user-uuid",
  userAddress: "0xabcd",
  merchantId: "merch-uuid",
  productId: "product-uuid",
  productCategory: "electronics",
  orderId: "order-uuid",
  discountApplied: 5,
};

async function getClaimVoucher() {
  vi.resetModules();
  return (await import("@/lib/vouchers/redemption")).claimVoucher;
}

async function getFinaliseRedemption() {
  vi.resetModules();
  return (await import("@/lib/vouchers/redemption")).finaliseRedemption;
}

describe("voucher redemption RPC mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    ["WRONG_OWNER", 403],
    ["WRONG_MERCHANT", 400],
    ["EXPIRED", 410],
    ["WRONG_STATUS", 409],
  ])("maps claim %s to HTTP %i", async (errorCode, expectedStatus) => {
    mockRpc.mockResolvedValue({
      data: [{ ok: false, error_code: errorCode }],
      error: null,
    });
    const claimVoucher = await getClaimVoucher();

    const result = await claimVoucher(CLAIM_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(expectedStatus);
  });

  it("passes every linked wallet to legacy ownership validation", async () => {
    mockRpc.mockResolvedValue({
      data: [{ ok: true, error_code: "" }],
      error: null,
    });
    const claimVoucher = await getClaimVoucher();

    await claimVoucher({
      ...CLAIM_PARAMS,
      userAddresses: ["0xprimary", "0xsecondary"],
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_voucher_atomic",
      expect.objectContaining({
        p_user_addresses: ["0xprimary", "0xsecondary"],
      }),
    );
  });

  it.each([
    ["WRONG_OWNER", 403],
    ["WRONG_MERCHANT", 400],
    ["WRONG_PRODUCT", 400],
    ["WRONG_CATEGORY", 400],
    ["EXPIRED", 410],
    ["VOUCHER_NOT_FOUND", 404],
    ["DISCOUNT_EXCEEDS_CAP", 400],
  ])("maps redemption %s to HTTP %i", async (errorCode, expectedStatus) => {
    mockRpc.mockResolvedValue({
      data: [{ ok: false, error_code: errorCode, discount_usd: 0 }],
      error: null,
    });
    const finaliseRedemption = await getFinaliseRedemption();

    const result = await finaliseRedemption(FINALISE_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(expectedStatus);
  });

  it("returns the discount from successful atomic redemption", async () => {
    mockRpc.mockResolvedValue({
      data: [{ ok: true, error_code: "", discount_usd: 5 }],
      error: null,
    });
    const finaliseRedemption = await getFinaliseRedemption();

    const result = await finaliseRedemption(FINALISE_PARAMS);

    expect(result).toEqual({ ok: true, discountUsd: 5 });
  });
});
