import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
  resolution: {
    ok: true,
    username: "awino",
    usernameNormalized: "awino",
    hubUserId: "00000000-0000-4000-8000-000000000002",
    canonicalId: "00000000-0000-4000-8000-000000000003",
  } as Record<string, unknown>,
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/requestSecurity", () => ({ isTrustedMutationRequest: () => true }));
vi.mock("@/lib/voucherFundsAccess", () => ({
  fundedVoucherAdminGuard: () => null,
  fundedVoucherActorId: (session: Record<string, unknown>) => session.adminUserId,
}));
vi.mock("@/lib/voucherUsername", () => ({
  resolveVoucherRecipientUsername: async () => state.resolution,
  USERNAME_ERROR_MESSAGES: { USERNAME_NOT_FOUND: "No member found." },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: state.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              program_id: "00000000-0000-4000-8000-000000000004",
              partners: { name: "Pwani Coffee" },
              voucher_funding_programs: { name: "Founding Partners" },
            },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

const route = await import("@/app/api/vouchers/grant/route");

const ALLOCATION_ID = "00000000-0000-4000-8000-000000000001";
const CONFIRMATION_ID = "00000000-0000-4000-8000-000000000005";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/vouchers/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  allocation_id: ALLOCATION_ID,
  member_username: "awino",
  operator_reason: "Service recovery grant",
  confirmation_id: CONFIRMATION_ID,
};

describe("POST /api/vouchers/grant", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.resolution = {
      ok: true,
      username: "awino",
      usernameNormalized: "awino",
      hubUserId: "00000000-0000-4000-8000-000000000002",
      canonicalId: "00000000-0000-4000-8000-000000000003",
    };
  });

  it("requires an authorized voucher-grant session", async () => {
    const response = await route.POST(request(validBody));
    expect(response.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("validates the deliberate confirmation and operator reason", async () => {
    state.session = { adminUserId: "00000000-0000-4000-8000-000000000006", role: "ops_admin" };
    const response = await route.POST(request({ ...validBody, confirmation_id: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("issues atomically with a deterministic idempotency key and writes an audit row", async () => {
    state.session = { adminUserId: "00000000-0000-4000-8000-000000000006", role: "ops_admin" };
    state.rpc.mockResolvedValue({
      data: [{
        ok: true,
        voucher_id: "00000000-0000-4000-8000-000000000007",
        claim_id: "00000000-0000-4000-8000-000000000008",
        voucher_status: "issued",
        expires_at: "2026-11-01T10:00:00Z",
        idempotent: false,
        error_code: "",
      }],
      error: null,
    });

    const response = await route.POST(request(validBody));
    expect(response.status).toBe(201);
    expect(state.rpc).toHaveBeenCalledWith(
      "claim_akiba_funded_voucher_atomic",
      expect.objectContaining({
        p_allocation_id: ALLOCATION_ID,
        p_claim_mode: "internal_grant",
        p_hub_user_id: "00000000-0000-4000-8000-000000000002",
        p_canonical_id: "00000000-0000-4000-8000-000000000003",
        p_idempotency_key: `admin-grant:${ALLOCATION_ID}:00000000-0000-4000-8000-000000000003:${CONFIRMATION_ID}`,
      }),
    );
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "voucher.issue.succeeded",
      targetId: "00000000-0000-4000-8000-000000000007",
    }));
    expect((await response.json()).voucher.merchantName).toBe("Pwani Coffee");
  });

  it("maps atomic budget failures to actionable copy", async () => {
    state.session = { adminUserId: "00000000-0000-4000-8000-000000000006", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: [{ ok: false, error_code: "BUDGET_EXHAUSTED" }], error: null });
    const response = await route.POST(request(validBody));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/budget remaining/i);
    expect(state.audit).not.toHaveBeenCalled();
  });
});
