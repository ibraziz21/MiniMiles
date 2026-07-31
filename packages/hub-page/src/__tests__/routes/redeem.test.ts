import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1", email: "user@example.com" } as {
    id: string;
    email?: string;
  } | null,
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

const mockIssueVoucher = vi.fn();
vi.mock("@/lib/vouchers/issuance", () => ({
  issueVoucher: mockIssueVoucher,
}));

const { POST } = await import("@/app/api/shop/vouchers/redeem/route");

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/shop/vouchers/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: "template-1",
      quote_id: "quote-1",
      confirmed: true,
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

describe("POST /api/shop/vouchers/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: "hub-user-1", email: "user@example.com" };
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

  it("requires authentication", async () => {
    state.user = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("requires an explicitly confirmed quote", async () => {
    const response = await POST(request({ confirmed: false }));
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
    expect(body.queued).toBe(true);
    expect(body.intent_state).toBe("onchain_submitted");
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
