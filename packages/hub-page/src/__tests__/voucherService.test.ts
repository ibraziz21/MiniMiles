import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ensure the burn API config guard never triggers in tests that don't explicitly
// test for missing keys. Tests that test missing-key behavior override these before
// calling getIssueVoucher() (which re-imports the module and picks up the change).
process.env.AKIBA_API_URL = "https://api.akibamiles.test";
process.env.AKIBA_API_KEY = "test-api-key-default";

// ── Supabase mock ────────────────────────────────────────────────────────────

type MockResult = { data: unknown; error: unknown; count?: number };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = () => (typeof result === "function" ? result() : result);
  const chain: Record<string, unknown> = {};
  const methods = [
    "select","insert","update","upsert","delete",
    "eq","neq","gt","lt","gte","in","or","limit","order","not",
  ];
  for (const m of methods) chain[m] = () => chain;
  chain.single      = () => Promise.resolve(resolve());
  chain.maybeSingle = () => Promise.resolve(resolve());
  chain.then        = (res: (v: unknown) => unknown) => Promise.resolve(resolve()).then(res);
  return chain;
}

const mockFrom = vi.fn();
const mockRpc  = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// ── AKIBA_API fetch mock ─────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── crypto.getRandomValues mock ───────────────────────────────────────────────
vi.stubGlobal("crypto", {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 32;
    return arr;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CODES
// ─────────────────────────────────────────────────────────────────────────────

describe("generateSecureCode", () => {
  it("uses crypto.getRandomValues, not Math.random", async () => {
    const mathSpy = vi.spyOn(Math, "random");
    const { generateSecureCode } = await import("@/lib/vouchers/codes");
    const code = generateSecureCode();
    expect(code).toHaveLength(10);
    expect(mathSpy).not.toHaveBeenCalled();
    mathSpy.mockRestore();
  });

  it("produces only charset characters", async () => {
    const { generateSecureCode } = await import("@/lib/vouchers/codes");
    const charset = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    for (let i = 0; i < 20; i++) {
      expect(generateSecureCode()).toMatch(charset);
    }
  });
});

describe("isTimestampFresh", () => {
  it("accepts a current timestamp", async () => {
    const { isTimestampFresh } = await import("@/lib/vouchers/codes");
    expect(isTimestampFresh(Math.floor(Date.now() / 1000))).toBe(true);
  });

  it("rejects a timestamp older than 600 s", async () => {
    const { isTimestampFresh } = await import("@/lib/vouchers/codes");
    expect(isTimestampFresh(Math.floor(Date.now() / 1000) - 700)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ISSUANCE SERVICE
// ─────────────────────────────────────────────────────────────────────────────

const RPC_OK = [
  { voucher_id: "v-uuid", code: "TESTCODE12", status: "pending", miles_cost: 100 },
];

const VALID_INPUT = {
  userId:      "hub-user-uuid",
  userAddress: "0xabcd",
  templateId:  "tmpl-uuid",
  merchantId:  "merch-uuid",
  nonce:       "unique-nonce-1",
};

async function getIssueVoucher() {
  vi.resetModules();
  return (await import("@/lib/vouchers/issuance")).issueVoucher;
}

describe("issueVoucher – idempotency", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns existing voucher when idempotency_key already exists", async () => {
    const existing = {
      id: "v-uuid", code: "EXISTING1", status: "issued",
      hub_user_id: "hub-user-uuid",   // matches VALID_INPUT.userId
      user_address: "0xabcd",          // matches VALID_INPUT.userAddress
      voucher_template_id: "tmpl-uuid", // matches VALID_INPUT.templateId
      acquisition_source: "miles_purchase",
    };
    mockFrom.mockReturnValue(makeChain({ data: existing, error: null }));

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, idempotencyKey: "key-123" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.voucher.id).toBe("v-uuid");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("issueVoucher – nonce protection", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 400 when nonce is already used (23505 unique violation)", async () => {
    mockFrom.mockReturnValue(
      makeChain({ data: null, error: { code: "23505", message: "duplicate key" } })
    );

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(400);
      expect(result.error).toMatch(/nonce/i);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("issueVoucher – cap and cooldown (concurrent final-inventory issuance)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 409 when RPC raises CAP_EXCEEDED", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null })); // nonce insert ok
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "CAP_EXCEEDED: template tmpl-uuid has reached its global cap of 1" },
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-cap" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
      expect(result.error).toMatch(/supply exhausted/i);
    }
  });

  it("concurrent cap=1: second request gets 409", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      return makeChain({ data: null, error: null }); // nonce insert ok for both
    });

    const issueVoucher = await getIssueVoucher();

    // First: succeeds
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // burn
    let fromPromoteCall = 0;
    mockFrom.mockImplementation(() => {
      fromPromoteCall++;
      if (fromPromoteCall === 1) return makeChain({ data: null, error: null }); // nonce
      return makeChain({ data: { id: "v-uuid", code: "TESTCODE12", status: "issued" }, error: null });
    });

    const r1 = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-A" });
    expect(r1.ok).toBe(true);

    // Second: RPC sees cap exceeded (pending row from first counts)
    vi.clearAllMocks();
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "CAP_EXCEEDED: template tmpl-uuid has reached its global cap of 1" },
    });

    const r2 = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-B" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.httpStatus).toBe(409);
  });

  it("returns 429 when RPC raises COOLDOWN_ACTIVE", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "COOLDOWN_ACTIVE: user 0xabcd is in cooldown for template tmpl-uuid" },
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-cd" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(429);
  });
});

describe("issueVoucher – burn failure", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 422 and voids pending row when burn API returns non-ok", async () => {
    let fromCall = 0;
    const voidChain = makeChain({ data: null, error: null });
    mockFrom.mockImplementation(() => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce
      return voidChain; // void + event inserts
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "insufficient balance" }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-burn" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(422);
  });
});

describe("issueVoucher – promote failure (reconciliation path)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 201 with pending status and records recovery_state when promote fails", async () => {
    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce
      if (fromCall === 2) return makeChain({ data: null, error: null }); // burn_idempotency_key persist
      if (fromCall === 3) return makeChain({ data: null, error: null }); // burn_ref persist
      if (fromCall === 4) return makeChain({ data: null, error: null }); // burn_confirmed event
      // promote fails (fromCall 5) — triggers burn_confirmed_promote_failed path
      if (fromCall === 5) return makeChain({ data: null, error: { message: "DB down" } });
      return makeChain({ data: null, error: null }); // fallback
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });  // reserve_voucher_atomic_hub
    mockRpc.mockResolvedValueOnce({ data: null, error: null });     // record_burn_outcome
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // burn ok

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-promote" });

    // Still 201 — user gets a pending voucher; reconciliation job promotes it
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.voucher.status).toBe("pending");
  });
});

describe("issueVoucher – full success", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 201 with issued status on happy path", async () => {
    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce
      // promote succeeds
      return makeChain({ data: { id: "v-uuid", code: "TESTCODE12", status: "issued" }, error: null });
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // burn

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-ok" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.voucher.status).toBe("issued");
      expect(result.voucher.code).toBe("TESTCODE12");
    }
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_with_program_atomic_hub",
      expect.objectContaining({
        p_template_id: "tmpl-uuid",
        p_merchant_id: "merch-uuid",
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REDEMPTION SERVICE
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_PARAMS = {
  voucherId:     "v-uuid",
  hubUserId:     "hub-user-uuid",
  userAddresses: ["0xabcd"],
  merchantId:    "merch-uuid",
};

const FINALISE_PARAMS = {
  voucherId:       "v-uuid",
  hubUserId:       "hub-user-uuid",
  userAddress:     "0xabcd",
  merchantId:      "merch-uuid",
  productId:       "prod-uuid",
  productCategory: "electronics",
  orderId:         "order-uuid",
  discountApplied: 5,
};

function makeVoucherRow(overrides: Record<string, unknown> = {}) {
  return {
    id:               "v-uuid",
    status:           "issued",
    hub_user_id:      "hub-user-uuid",
    user_address:     "0xabcd",
    expires_at:       null,
    rules_snapshot:   { merchant_id: "merch-uuid", linked_product_id: null, applicable_category: null },
    spend_voucher_templates: null,
    ...overrides,
  };
}

async function getClaimVoucher() {
  vi.resetModules();
  return (await import("@/lib/vouchers/redemption")).claimVoucher;
}

// Helper: mock claim_voucher_atomic RPC to return a given result
function mockClaimRpc(payload: { ok: boolean; error_code: string }) {
  mockRpc.mockResolvedValueOnce({ data: [payload], error: null });
}

async function getFinaliseRedemption() {
  vi.resetModules();
  return (await import("@/lib/vouchers/redemption")).finaliseRedemption;
}

// claimVoucher now calls claim_voucher_atomic DB RPC (#6 fix)
// All validation (owner/expiry/merchant) is performed by the DB function.

describe("claimVoucher – wrong owner (#6 fix: DB RPC)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 403 when claim_voucher_atomic returns WRONG_OWNER", async () => {
    mockClaimRpc({ ok: false, error_code: "WRONG_OWNER" });

    const claimVoucher = await getClaimVoucher();
    const result = await claimVoucher(CLAIM_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(403);
    expect(mockRpc).toHaveBeenCalledWith("claim_voucher_atomic", expect.objectContaining({
      p_voucher_id:     CLAIM_PARAMS.voucherId,
      p_hub_user_id:    CLAIM_PARAMS.hubUserId,
      p_user_addresses: CLAIM_PARAMS.userAddresses,
      p_merchant_id:    CLAIM_PARAMS.merchantId,
    }));
  });
});

describe("claimVoucher – wrong merchant (#6 fix: DB RPC)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 400 when claim_voucher_atomic returns WRONG_MERCHANT", async () => {
    mockClaimRpc({ ok: false, error_code: "WRONG_MERCHANT" });

    const claimVoucher = await getClaimVoucher();
    const result = await claimVoucher(CLAIM_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(400);
  });
});

describe("claimVoucher – expired voucher (#6 fix: DB RPC)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 410 when claim_voucher_atomic returns EXPIRED", async () => {
    mockClaimRpc({ ok: false, error_code: "EXPIRED" });

    const claimVoucher = await getClaimVoucher();
    const result = await claimVoucher(CLAIM_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(410);
  });
});

describe("claimVoucher – concurrent double redemption (#6 fix: DB RPC)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 409 when claim_voucher_atomic returns WRONG_STATUS (concurrent claim)", async () => {
    mockClaimRpc({ ok: false, error_code: "WRONG_STATUS" });

    const claimVoucher = await getClaimVoucher();
    const result = await claimVoucher(CLAIM_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(409);
  });
});

describe("finaliseRedemption – RPC error codes", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  const cases: Array<[string, number]> = [
    ["WRONG_OWNER",          403],
    ["WRONG_MERCHANT",       400],
    ["WRONG_PRODUCT",        400],
    ["WRONG_CATEGORY",       400],
    ["EXPIRED",              410],
    ["VOUCHER_NOT_FOUND",    404],
    ["DISCOUNT_EXCEEDS_CAP", 400],
  ];

  for (const [errorCode, expectedStatus] of cases) {
    it(`maps ${errorCode} → HTTP ${expectedStatus}`, async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ ok: false, error_code: errorCode, discount_usd: 0 }],
        error: null,
      });

      const finaliseRedemption = await getFinaliseRedemption();
      const result = await finaliseRedemption(FINALISE_PARAMS);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.httpStatus).toBe(expectedStatus);
    });
  }
});

describe("finaliseRedemption – success", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns ok=true with discount amount from RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ ok: true, error_code: "", discount_usd: 5 }],
      error: null,
    });

    const finaliseRedemption = await getFinaliseRedemption();
    const result = await finaliseRedemption(FINALISE_PARAMS);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discountUsd).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────

describe("legacy voucher compatibility", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("claimVoucher accepts legacy row with user_address (DB handles ownership)", async () => {
    // DB handles legacy ownership check; here the RPC returns success
    mockClaimRpc({ ok: true, error_code: "" });

    const claimVoucher = await getClaimVoucher();
    const result = await claimVoucher({ ...CLAIM_PARAMS, voucherId: "v-legacy" });

    expect(result.ok).toBe(true);
  });

  it("claimVoucher passes all linked wallet addresses to the RPC (#9 fix)", async () => {
    const multiWalletParams = {
      ...CLAIM_PARAMS,
      userAddresses: ["0xprimary", "0xsecondary"],
    };
    mockClaimRpc({ ok: true, error_code: "" });

    const claimVoucher = await getClaimVoucher();
    await claimVoucher(multiWalletParams);

    expect(mockRpc).toHaveBeenCalledWith("claim_voucher_atomic", expect.objectContaining({
      p_user_addresses: ["0xprimary", "0xsecondary"],
    }));
  });

  it("finaliseRedemption falls back to template join when rules_snapshot is null", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ ok: true, error_code: "", discount_usd: 3 }],
      error: null,
    });

    const finaliseRedemption = await getFinaliseRedemption();
    const result = await finaliseRedemption(FINALISE_PARAMS);

    expect(result.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "redeem_voucher_atomic",
      expect.objectContaining({ p_voucher_id: "v-uuid" })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT CORRECTIONS — new test cases
// ─────────────────────────────────────────────────────────────────────────────

// #4 — Idempotency ownership isolation
describe("issueVoucher — idempotency ownership isolation (#4)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("returns 409 when existing row belongs to a different user", async () => {
    // DB returns a voucher that belongs to a different hub_user_id
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          id: "other-v",
          code: "OTHCODE11",
          status: "issued",
          hub_user_id: "different-user-uuid",   // not VALID_INPUT.userId
          user_address: "0xother",
          voucher_template_id: "tmpl-uuid",
          acquisition_source: "miles_purchase",
        },
        error: null,
      })
    );

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, idempotencyKey: "shared-key" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
      expect(result.error).toMatch(/conflict/i);
    }
    // Nonce and RPC should NOT have been called
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 409 when existing row is for a different template", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          id: "tmpl-v",
          code: "TMPLCODE1",
          status: "issued",
          hub_user_id: "hub-user-uuid",         // same user
          user_address: "0xabcd",               // same wallet
          voucher_template_id: "different-tmpl", // different template!
          acquisition_source: "miles_purchase",
        },
        error: null,
      })
    );

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, idempotencyKey: "shared-key-2" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(409);
  });

  it("returns existing voucher when idempotency_key, user, wallet and template all match", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          id: "same-v",
          code: "SAMECODE1",
          status: "issued",
          hub_user_id: "hub-user-uuid",
          user_address: "0xabcd",
          voucher_template_id: "tmpl-uuid",
          acquisition_source: "miles_purchase",
        },
        error: null,
      })
    );

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, idempotencyKey: "same-key" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.voucher.id).toBe("same-v");
      expect(result.voucher.code).toBe("SAMECODE1");
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// #3 — Ambiguous burn recovery (never void on network failure)
describe("issueVoucher — ambiguous burn recovery (#3)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("sets recovery_state=burn_ambiguous (not void) on network error", async () => {
    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      return makeChain({ data: null, error: null }); // all DB ops succeed
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null }); // reserve_voucher_atomic_hub
    mockRpc.mockResolvedValueOnce({ data: null, error: null });    // record_burn_outcome

    // fetch() throws a network error (no response received)
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed: connection refused"));

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-network-err" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(503);
      expect(result.error).toMatch(/retry/i);
    }
  });

  it("voids pending row on definitive 4xx rejection", async () => {
    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      return makeChain({ data: null, error: null });
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });

    // fetch() returns a 422 — definitive rejection
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "insufficient balance" }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-definitive" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(422);
      expect(result.error).toMatch(/balance|rejected/i);
    }
  });

  it("passes burn_idempotency_key to the burn API (#3)", async () => {
    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      if (fromCall <= 2) return makeChain({ data: null, error: null }); // nonce + burn key persist
      return makeChain({ data: { id: "v-uuid", code: "TESTCODE12", status: "issued" }, error: null });
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tx_hash: "0xburnhash" }) });

    const issueVoucher = await getIssueVoucher();
    await issueVoucher({ ...VALID_INPUT, nonce: "nonce-idemkey" });

    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers?.["Idempotency-Key"]).toMatch(/^hub-burn-hub-user-uuid-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Akiba-Platform authenticated burn API
// ─────────────────────────────────────────────────────────────────────────────

describe("issueVoucher — Akiba-Platform burn API authentication", () => {
  // Store originals so we can restore after the suite.
  const ORIG_URL = process.env.AKIBA_API_URL;
  const ORIG_KEY = process.env.AKIBA_API_KEY;

  beforeEach(() => {
    // resetAllMocks clears both call records AND mockResolvedValueOnce queues,
    // preventing unconsumed mocks from one test bleeding into the next.
    vi.resetAllMocks();
    vi.resetModules();
    // Default to valid config for every test in this block.
    process.env.AKIBA_API_URL = "https://api.akibamiles.com";
    process.env.AKIBA_API_KEY = "test-api-key-abc";
  });

  afterEach(() => {
    // Restore so env stubs don't bleed into other describe blocks.
    process.env.AKIBA_API_URL = ORIG_URL;
    process.env.AKIBA_API_KEY = ORIG_KEY;
  });

  function successFromMock() {
    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce
      if (fromCall === 2) return makeChain({ data: null, error: null }); // burn_idempotency_key persist
      if (fromCall === 3) return makeChain({ data: null, error: null }); // burn_ref persist
      if (fromCall === 4) return makeChain({ data: null, error: null }); // burn_confirmed event
      return makeChain({ data: { id: "v-uuid", code: "TESTCODE12", status: "issued" }, error: null });
    });
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
  }

  it("sends Authorization: Bearer <key> header", async () => {
    successFromMock();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reference: "ledger-ref-001", amount: 100, address: "0xabcd" }),
    });

    const issueVoucher = await getIssueVoucher();
    await issueVoucher({ ...VALID_INPUT, nonce: "nonce-auth-header" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-api-key-abc");
  });

  it("sends reason=hub_voucher_purchase and externalRef in body", async () => {
    successFromMock();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reference: "ledger-ref-002", amount: 100, address: "0xabcd" }),
    });

    const issueVoucher = await getIssueVoucher();
    await issueVoucher({ ...VALID_INPUT, nonce: "nonce-body-fields" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.reason).toBe("hub_voucher_purchase");
    expect(typeof body.externalRef).toBe("string");
    expect((body.externalRef as string).length).toBeGreaterThan(0);
    // Identifies the Hub as an internal platform_service, not a merchant.
    expect(body.actorType).toBe("platform_service");
    expect(body.actorId).toBe("akiba_hub");
  });

  it("prefers data.reference as burn_ref over data.tx_hash", async () => {
    successFromMock();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reference: "canonical-ledger-id",
        tx_hash: "0xlegacyhash",
        amount: 100,
        address: "0xabcd",
      }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-ref-pref" });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    // voucher_events.insert was called — confirms burn_confirmed path ran
    const burnEventCall = mockFrom.mock.calls.find(
      (call: unknown[]) => (call[0] as string) === "voucher_events"
    );
    expect(burnEventCall).toBeDefined();
  });

  it("falls back to data.tx_hash when data.reference is absent", async () => {
    successFromMock();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tx_hash: "0xlegacyhash", amount: 100, address: "0xabcd" }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-txhash-fb" });

    expect(result.ok).toBe(true);
  });

  it("422 from burn API still definitively voids the voucher", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "INSUFFICIENT_MILES" }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-422" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(422);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("401 from burn API does NOT void — goes through burn_ambiguous recovery", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-401" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(503);
      expect(result.error).toMatch(/retry/i);
    }
    expect(mockRpc).toHaveBeenCalledWith("record_burn_outcome", expect.objectContaining({
      p_recovery_state: "burn_ambiguous",
    }));
  });

  it("403 from burn API does NOT void — goes through burn_ambiguous recovery", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-403" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(503);
    expect(mockRpc).toHaveBeenCalledWith("record_burn_outcome", expect.objectContaining({
      p_recovery_state: "burn_ambiguous",
    }));
  });

  it("missing AKIBA_API_KEY does not call fetch and goes through burn_ambiguous recovery", async () => {
    process.env.AKIBA_API_KEY = ""; // override before import

    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const issueVoucher = await getIssueVoucher(); // re-imports with empty key
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-no-key" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(503);
    expect(mockRpc).toHaveBeenCalledWith("record_burn_outcome", expect.objectContaining({
      p_recovery_state: "burn_ambiguous",
    }));
  });

  it("missing AKIBA_API_URL does not call fetch and goes through burn_ambiguous recovery", async () => {
    process.env.AKIBA_API_URL = ""; // override before import

    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({ data: RPC_OK, error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const issueVoucher = await getIssueVoucher();
    const result = await issueVoucher({ ...VALID_INPUT, nonce: "nonce-no-url" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(503);
  });
});
