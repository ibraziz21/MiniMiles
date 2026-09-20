import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
  programRow: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/adminSettings", () => ({
  getAdminSettings: async () => ({
    finance: { voucherFundMakerCheckerThresholdKes: 0 },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: state.rpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === "voucher_funding_programs" ? state.programRow : null, error: null }),
        }),
      }),
    }),
  },
}));

const createRoute = await import("@/app/api/admin/voucher-funds/route");
const submitRoute = await import("@/app/api/admin/voucher-funds/[fundId]/submit/route");
const approveRoute = await import("@/app/api/admin/voucher-funds/[fundId]/approve/route");

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/voucher-funds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/voucher-funds", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.programRow = null;
  });

  it("requires an admin session", async () => {
    const res = await createRoute.POST(post({}));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid country code before calling the RPC", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    const res = await createRoute.POST(
      post({
        name: "Founding Partners Launch",
        countryCode: "kenya",
        authorizedBudgetKes: 5000,
        startsAt: "2026-01-01T00:00:00Z",
        endsAt: "2026-02-01T00:00:00Z",
      }),
    );
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("converts KES to minor units and calls the create RPC", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: { id: "fund-1" }, error: null });
    const res = await createRoute.POST(
      post({
        name: "Founding Partners Launch",
        countryCode: "ke",
        authorizedBudgetKes: 5000,
        startsAt: "2026-01-01T00:00:00Z",
        endsAt: "2026-02-01T00:00:00Z",
      }),
    );
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "create_voucher_funding_program_atomic",
      expect.objectContaining({ p_country_code: "KE", p_authorized_budget_minor: 500_000, p_created_by: "admin-1" }),
    );
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "voucher_fund.created" }));
  });

  it("maps a stable RPC error code to an admin-safe message and status", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: null, error: { message: "INVALID_PROGRAM_WINDOW" } });
    const res = await createRoute.POST(
      post({
        name: "Founding Partners Launch",
        countryCode: "KE",
        authorizedBudgetKes: 5000,
        startsAt: "2026-02-01T00:00:00Z",
        endsAt: "2026-01-01T00:00:00Z",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/start must be before/i);
  });
});

describe("POST /api/admin/voucher-funds/:fundId/submit", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("passes the submit action through to the transition RPC", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: { id: "fund-1", state: "pending_approval" }, error: null });
    const res = await submitRoute.POST(
      new NextRequest("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ fundId: "fund-1" }) },
    );
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "transition_voucher_funding_program_atomic",
      expect.objectContaining({ p_program_id: "fund-1", p_action: "submit", p_actor_id: "admin-1" }),
    );
  });
});

describe("POST /api/admin/voucher-funds/:fundId/approve", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.programRow = null;
  });

  it("rejects a reason shorter than 4 characters before calling the RPC", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    const res = await approveRoute.POST(post({ reason: "ok" }), { params: Promise.resolve({ fundId: "fund-1" }) });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("blocks the creator from approving their own commitment past the maker-checker threshold", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    state.programRow = { created_by: "admin-1", authorized_budget_minor: 500_000 };
    const res = await approveRoute.POST(post({ reason: "looks good" }), {
      params: Promise.resolve({ fundId: "fund-1" }),
    });
    expect(res.status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("allows a different approver to approve", async () => {
    state.session = { adminUserId: "admin-2", role: "finance_admin" };
    state.programRow = { created_by: "admin-1", authorized_budget_minor: 500_000 };
    state.rpc.mockResolvedValue({ data: { id: "fund-1", state: "approved" }, error: null });
    const res = await approveRoute.POST(post({ reason: "looks good" }), {
      params: Promise.resolve({ fundId: "fund-1" }),
    });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "transition_voucher_funding_program_atomic",
      expect.objectContaining({ p_action: "approve", p_reason: "looks good" }),
    );
  });
});
