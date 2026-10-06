import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer"; accessToken: string } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  quote: {
    purchase_key: "hub-voucher:stable-key",
    wallet_address: null as string | null,
    disclosure_version: "v1",
    hub_user_id: "hub-user-1",
    template_id: "template-1",
  } as Record<string, unknown> | null,
  linkedWallet: { address: "0xprimary" } as { address: string } | null,
  template: {
    partner_id: "merchant-uuid",
    miles_cost: 100,
  } as { partner_id: string; miles_cost: number } | null,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

const mockIssueVoucher = vi.fn();
vi.mock("@/lib/vouchers/issuance", () => ({
  issueVoucher: mockIssueVoucher,
}));

const mockRecordClaimIntent = vi.fn();
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: async () => ({ expiredUnusedCount: 0, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: false }),
  claimIntentIsValid: (confirmed: unknown) => confirmed === true,
  isVoucherUsePlan: (value: unknown) => typeof value === "string",
  recordVoucherClaimIntent: (...args: unknown[]) => mockRecordClaimIntent(...args),
}));

const { POST } = await import("@/app/api/v1/vouchers/redeem/route");

function request(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/vouchers/redeem", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: JSON.stringify({
      template_id: "template-1",
      quote_id: "quote-1",
      confirmed: true,
      intent_confirmed: true,
      ...overrides,
    }),
  });
}

function terminal(data: unknown, error: unknown = null) {
  return {
    maybeSingle: async () => ({ data, error }),
  };
}

function setupAdmin() {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "voucher_purchase_quotes") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.quote, error: null }),
          }),
        }),
      };
    }
    if (table === "hub_user_wallets") {
      const node: { eq: () => typeof node } & ReturnType<typeof terminal> = Object.assign(
        terminal(state.linkedWallet),
        { eq: () => node }
      );
      return { select: () => node };
    }
    if (table === "spend_voucher_templates") {
      return {
        select: () => ({
          eq: () => terminal(state.template),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

describe("POST /api/v1/vouchers/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "bearer", accessToken: "t1" };
    state.quote = {
      purchase_key: "hub-voucher:stable-key",
      wallet_address: null,
      disclosure_version: "v1",
      hub_user_id: "hub-user-1",
      template_id: "template-1",
    };
    state.linkedWallet = { address: "0xprimary" };
    state.template = { partner_id: "merchant-uuid", miles_cost: 100 };
    mockIssueVoucher.mockResolvedValue({
      ok: true,
      voucher: { id: "voucher-1", code: "TESTCODE12", status: "issued" },
      intentState: "finalized",
    });
    setupAdmin();
  });

  it("returns 401 when unauthenticated", async () => {
    state.actor = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("rejects a cookie-authenticated cross-origin mutation with 403", async () => {
    state.actor = { userId: "hub-user-1", email: "user@example.com", authMode: "cookie", accessToken: "t1" };
    const response = await POST(request({}, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("rejects a bearer-authenticated mutation with the wrong content type", async () => {
    const response = await POST(request({}, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("requires an explicitly confirmed quote", async () => {
    const response = await POST(request({ confirmed: false }));
    expect(response.status).toBe(400);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("requires confirmation that the member intends to use the voucher", async () => {
    const response = await POST(request({ intent_confirmed: false }));
    expect(response.status).toBe(400);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("allows a walletless ledger-only quote", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mockIssueVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "hub-user-1",
        userAddress: null,
        idempotencyKey: "hub-voucher:stable-key",
        quoteId: "quote-1",
        consentMethod: "hub_ui_confirmed",
        disclosureVersion: "v1",
      }),
    );
    expect(mockAdminFrom).not.toHaveBeenCalledWith("hub_user_wallets");
    expect(mockRecordClaimIntent).toHaveBeenCalledWith(expect.objectContaining({ voucherId: "voucher-1", flow: "miles_purchase" }));
  });

  it("uses the exact wallet bound to an on-chain quote", async () => {
    state.quote = {
      ...state.quote!,
      wallet_address: "0xPRIMARY",
    };

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mockIssueVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: "0xprimary" }),
    );
  });

  it("rejects a quote whose wallet is no longer linked", async () => {
    state.quote = { ...state.quote!, wallet_address: "0xmissing" };
    state.linkedWallet = null;

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("returns queued state to the client", async () => {
    mockIssueVoucher.mockResolvedValue({
      ok: true,
      voucher: { id: "voucher-1", code: "TESTCODE12", status: "pending" },
      queued: true,
      intentState: "onchain_submitted",
    });

    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    const data = body.data as Record<string, unknown>;
    expect(data.queued).toBe(true);
    expect(data.intentState).toBe("onchain_submitted");
  });

  it("forwards canonical purchase errors", async () => {
    mockIssueVoucher.mockResolvedValue({
      ok: false,
      error: "Not enough Miles",
      httpStatus: 422,
    });

    const response = await POST(request());

    expect(response.status).toBe(422);
  });
});
