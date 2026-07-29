import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1", email: "user@example.com" } as {
    id: string;
    email: string;
  } | null,
  template: {
    partner_id: "merchant-1",
    miles_cost: 100,
    active: true,
    expires_at: null,
  },
  wallets: [] as Array<{
    address: string;
    is_primary: boolean;
    linked_at: string;
  }>,
  ledger: 100,
  available: true,
  reserved: [] as Array<{ points: number }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

const mockReadChain = vi.fn();
vi.mock("@/lib/akiba/balance", () => ({
  readChainBalanceStrict: (...args: unknown[]) => mockReadChain(...args),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

const { POST } = await import("@/app/api/shop/vouchers/quote/route");

function request() {
  return new Request("http://localhost/api/shop/vouchers/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_id: "template-1" }),
  });
}

function setupAdmin() {
  mockRpc.mockImplementation((name: string) => {
    if (name === "list_available_voucher_template_ids_hub") {
      return Promise.resolve({
        data: state.available ? [{ template_id: "template-1" }] : [],
        error: null,
      });
    }
    if (name === "resolve_canonical_ids") {
      return Promise.resolve({ data: ["canonical-1"], error: null });
    }
    if (name === "available_ledger_points") {
      return Promise.resolve({ data: state.ledger, error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === "spend_voucher_templates") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.template, error: null }),
          }),
        }),
      };
    }
    if (table === "hub_user_wallets") {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.wallets, error: null }),
          }),
        }),
      };
    }
    if (table === "minipoint_burn_jobs") {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: state.reserved, error: null }),
          }),
        }),
      };
    }
    if (table === "voucher_purchase_quotes") {
      return {
        insert: (values: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({
              data: {
                id: "quote-1",
                ledger_points: values.ledger_points,
                onchain_points: values.onchain_points,
                total_points: values.total_points,
                disclosure_version: values.disclosure_version,
                wallet_address: values.wallet_address,
              },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

describe("POST /api/shop/vouchers/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: "hub-user-1", email: "user@example.com" };
    state.wallets = [];
    state.ledger = 100;
    state.available = true;
    state.reserved = [];
    mockReadChain.mockResolvedValue({ ok: true, balance: 100 });
    setupAdmin();
  });

  it("creates a walletless ledger-only quote", async () => {
    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ledger_points).toBe(100);
    expect(body.onchain_points).toBe(0);
    expect(body.wallet_address).toBeNull();
    expect(mockReadChain).not.toHaveBeenCalled();
  });

  it("binds an on-chain shortfall to the primary wallet", async () => {
    state.ledger = 40;
    state.wallets = [
      { address: "0xsecondary", is_primary: false, linked_at: "2026-01-02" },
      { address: "0xPRIMARY", is_primary: true, linked_at: "2026-01-01" },
    ];

    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ledger_points).toBe(40);
    expect(body.onchain_points).toBe(60);
    expect(body.wallet_address).toBe("0xprimary");
    expect(mockReadChain).toHaveBeenCalledWith("0xprimary");
  });

  it("subtracts existing on-chain reservations", async () => {
    state.ledger = 0;
    state.wallets = [
      { address: "0xprimary", is_primary: true, linked_at: "2026-01-01" },
    ];
    state.reserved = [{ points: 25 }];
    mockReadChain.mockResolvedValue({ ok: true, balance: 110 });

    const response = await POST(request());

    expect(response.status).toBe(422);
  });

  it("does not quote catalog inventory that reservation would reject", async () => {
    state.available = false;

    const response = await POST(request());

    expect(response.status).toBe(409);
  });
});
