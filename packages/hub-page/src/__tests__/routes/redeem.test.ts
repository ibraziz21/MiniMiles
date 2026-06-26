/**
 * Route-level tests for POST /api/shop/vouchers/redeem
 *
 * No wallet signature is required. The route resolves the user's linked wallet
 * from hub_user_wallets and delegates to issueVoucher (which burns miles via
 * the internal Akiba-Platform service key).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mutable per-test state ───────────────────────────────────────────────────
type WalletRow = { address: string; is_primary: boolean; linked_at: string };

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1" } as { id: string } | null,
  wallets: [
    { address: "0xprimary", is_primary: true, linked_at: "2024-06-01T00:00:00Z" },
  ] as WalletRow[],
  template: { partner_id: "merchant-uuid" } as { partner_id: string } | null,
}));

// ── Supabase mocks ───────────────────────────────────────────────────────────
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

// Admin client mock — returns chainable objects per table name.
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

// ── issueVoucher mock ────────────────────────────────────────────────────────
const mockIssueVoucher = vi.fn();

vi.mock("@/lib/vouchers/issuance", () => ({
  issueVoucher: mockIssueVoucher,
}));

// ── Import route AFTER mocks ──────────────────────────────────────────────────
const { POST } = await import("@/app/api/shop/vouchers/redeem/route");

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/shop/vouchers/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupAdminMock() {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "hub_user_wallets") {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.wallets, error: null }),
          }),
        }),
      };
    }
    if (table === "spend_voucher_templates") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.template, error: null }),
          }),
        }),
      };
    }
    return {
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
    };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/shop/vouchers/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: "hub-user-1" };
    state.wallets = [
      { address: "0xprimary", is_primary: true, linked_at: "2024-06-01T00:00:00Z" },
    ];
    state.template = { partner_id: "merchant-uuid" };
    mockIssueVoucher.mockResolvedValue({
      ok: true,
      voucher: { id: "v-uuid", code: "TESTCODE12", status: "issued" },
    });
    setupAdminMock();
  });

  // ── Auth ───────────────────────────────────────────────────────────────────
  it("returns 401 when unauthenticated", async () => {
    state.user = null;
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(401);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  // ── Wallet resolution ──────────────────────────────────────────────────────
  it("returns 400 with wallet message when no wallets are linked", async () => {
    state.wallets = [];
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/wallet/i);
    expect(mockIssueVoucher).not.toHaveBeenCalled();
  });

  it("calls issueVoucher with the primary wallet address (lowercased)", async () => {
    state.wallets = [
      { address: "0xSECONDARY", is_primary: false, linked_at: "2024-01-01T00:00:00Z" },
      { address: "0xPRIMARY",   is_primary: true,  linked_at: "2024-01-02T00:00:00Z" },
    ];

    const res = await POST(makeRequest({ template_id: "tmpl-1" }));

    expect(res.status).toBe(201);
    expect(mockIssueVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        userId:      "hub-user-1",
        userAddress: "0xprimary",   // lowercased
        templateId:  "tmpl-1",
        merchantId:  "merchant-uuid",
      })
    );
  });

  it("falls back to most-recently-linked wallet when no primary is set", async () => {
    // wallets ordered descending by linked_at (route queries ORDER BY linked_at DESC)
    state.wallets = [
      { address: "0xrecent", is_primary: false, linked_at: "2024-06-15T00:00:00Z" },
      { address: "0xolder",  is_primary: false, linked_at: "2024-01-01T00:00:00Z" },
    ];

    const res = await POST(makeRequest({ template_id: "tmpl-1" }));

    expect(res.status).toBe(201);
    expect(mockIssueVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: "0xrecent" })
    );
  });

  // ── No signature ───────────────────────────────────────────────────────────
  it("does not pass a signature to issueVoucher", async () => {
    await POST(makeRequest({ template_id: "tmpl-1" }));

    const call = mockIssueVoucher.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("signature");
  });

  // ── Nonce + idempotency key generation ────────────────────────────────────
  it("generates a server-side nonce (no client nonce in request)", async () => {
    await POST(makeRequest({ template_id: "tmpl-1" }));

    const call = mockIssueVoucher.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call.nonce).toBe("string");
    expect((call.nonce as string).length).toBeGreaterThan(0);
  });

  it("generates an idempotency key containing user.id and template_id when none supplied", async () => {
    await POST(makeRequest({ template_id: "tmpl-1" }));

    const call = mockIssueVoucher.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call.idempotencyKey).toBe("string");
    expect(call.idempotencyKey as string).toContain("hub-redeem-hub-user-1-tmpl-1");
  });

  it("passes through a caller-supplied idempotency_key unchanged", async () => {
    await POST(makeRequest({ template_id: "tmpl-1", idempotency_key: "my-idem-key" }));

    const call = mockIssueVoucher.mock.calls[0][0] as Record<string, unknown>;
    expect(call.idempotencyKey).toBe("my-idem-key");
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  it("returns 201 with the issued voucher on success", async () => {
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(201);
    const body = await res.json() as { voucher: { id: string; code: string; status: string } };
    expect(body.voucher.id).toBe("v-uuid");
    expect(body.voucher.code).toBe("TESTCODE12");
    expect(body.voucher.status).toBe("issued");
  });

  // ── Error forwarding from issueVoucher ────────────────────────────────────
  it("returns 409 when supply is exhausted", async () => {
    mockIssueVoucher.mockResolvedValueOnce({
      ok: false, error: "Supply exhausted for this voucher", httpStatus: 409,
    });
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(409);
  });

  it("returns 422 when miles burn is rejected (insufficient balance)", async () => {
    mockIssueVoucher.mockResolvedValueOnce({
      ok: false, error: "Miles burn rejected: insufficient balance or invalid address", httpStatus: 422,
    });
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(422);
  });

  it("returns 429 when user is in cooldown", async () => {
    mockIssueVoucher.mockResolvedValueOnce({
      ok: false, error: "cooldown_active", httpStatus: 429,
    });
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(429);
  });

  it("returns 503 when burn outcome is ambiguous (reconciliation pending)", async () => {
    mockIssueVoucher.mockResolvedValueOnce({
      ok: false,
      error: "Miles burn outcome unknown — please retry. Your voucher is held for reconciliation.",
      httpStatus: 503,
    });
    const res = await POST(makeRequest({ template_id: "tmpl-1" }));
    expect(res.status).toBe(503);
  });
});
