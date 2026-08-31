import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// NOTE: Supabase is mocked. These assert the MiniMiles route contract — RPC
// names, exact `p_*` parameter shape (must match Akiba migrations 092/096),
// error_code -> HTTP mapping, audit calls. They do NOT exercise the real
// database; a live contract test belongs in the Akiba billing DB suite.

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
  row: null as Record<string, unknown> | null, // generic .maybeSingle() payload
  signedUrl: { data: { signedUrl: "https://signed.example/evidence" }, error: null } as unknown,
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) =>
    session.openAccess ? null : (session.adminUserId ?? null),
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/adminSettings", () => ({
  getAdminSettings: async () => ({ finance: { businessName: "Akiba", businessEmail: "" } }),
}));
vi.mock("@/lib/supabase", () => {
  function chain() {
    const value: Record<string, unknown> = {
      select: () => value,
      eq: () => value,
      neq: () => value,
      order: () => value,
      in: () => value,
      ilike: () => value,
      gte: () => value,
      lte: () => value,
      limit: () => value,
      maybeSingle: () => Promise.resolve({ data: state.row, error: null }),
      then: (resolve: (arg: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return value;
  }
  return {
    supabase: {
      from: () => chain(),
      rpc: state.rpc,
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve(state.signedUrl) }) },
    },
  };
});

const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const PAST_DATE = new Date(Date.now() - 3 * 86_400_000).toISOString();

const confirm = await import(`@/app/api/admin/subscription-payments/[id]/confirm/route`);
const reject = await import(`@/app/api/admin/subscription-payments/[id]/reject/route`);
const startReview = await import(`@/app/api/admin/subscription-payments/[id]/start-review/route`);
const takeOver = await import(`@/app/api/admin/subscription-payments/[id]/take-over/route`);
const evidence = await import(`@/app/api/admin/subscription-payments/[id]/evidence-url/route`);

function post(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validConfirm = {
  expectedVersion: 3,
  confirmedReference: "THT9K4ABC1",
  confirmedAmount: "24000",
  confirmedCurrency: "KES",
  paymentDate: PAST_DATE,
  evidenceNote: "Matched in NCBA activity",
};

describe("subscription payment mutation routes", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.row = null;
  });

  it("rejects unauthenticated callers", async () => {
    const res = await confirm.POST(post({}), { params: { id: ATTEMPT } });
    expect(res.status).toBe(401);
  });

  it("forbids readonly finance users from deciding", async () => {
    state.session = { adminUserId: "a1", role: "readonly" };
    const res = await confirm.POST(post(validConfirm), { params: { id: ATTEMPT } });
    expect(res.status).toBe(403);
  });

  it("validates the confirm payload before calling the RPC", async () => {
    state.session = { adminUserId: "a1", role: "finance_admin" };

    const badCurrency = await confirm.POST(
      post({ ...validConfirm, confirmedCurrency: "USD" }),
      { params: { id: ATTEMPT } },
    );
    expect(badCurrency.status).toBe(400);

    const badAmount = await confirm.POST(
      post({ ...validConfirm, confirmedAmount: "24,000" }),
      { params: { id: ATTEMPT } },
    );
    expect(badAmount.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("calls confirm_subscription_payment with the Akiba 092 parameter shape", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    state.rpc.mockResolvedValue({
      data: [
        {
          ok: true,
          idempotent: false,
          invoice_id: "inv-1",
          invoice_status: "paid",
          receipt_number: "AKB-RCT-2026-000001",
          subscription_id: "sub-1",
          subscription_status: "active",
        },
      ],
      error: null,
    });
    state.row = {
      plan: "standard",
      billing_term: "annual",
      subscription_status: "active",
      subscription_billing_period: "annual",
      term_start: PAST_DATE,
      term_end: PAST_DATE,
      next_renewal_at: PAST_DATE,
      usage_period_end: PAST_DATE,
    };

    const res = await confirm.POST(post(validConfirm), { params: { id: ATTEMPT } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.receiptNumber).toBe("AKB-RCT-2026-000001");
    expect(body.subscription.plan).toBe("standard");
    expect(state.rpc).toHaveBeenCalledWith("confirm_subscription_payment", {
      p_attempt_id: ATTEMPT,
      p_admin_id: "admin-1",
      p_confirmed_amount: "24000.00",
      p_confirmed_reference: "THT9K4ABC1",
      p_expected_version: 3,
      p_allow_override: false,
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "subscription_payment.confirmed" }),
    );
  });

  it("maps a confirm error_code to 409 with the code echoed back", async () => {
    state.session = { adminUserId: "a1", role: "finance_admin" };
    state.rpc.mockResolvedValue({ data: [{ ok: false, error_code: "VERSION_CONFLICT" }], error: null });
    const res = await confirm.POST(post({ ...validConfirm, expectedVersion: 1 }), {
      params: { id: ATTEMPT },
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("VERSION_CONFLICT");
  });

  it("maps ATTEMPT_NOT_FOUND to 404", async () => {
    state.session = { adminUserId: "a1", role: "finance_admin" };
    state.rpc.mockResolvedValue({ data: [{ ok: false, error_code: "ATTEMPT_NOT_FOUND" }], error: null });
    const res = await confirm.POST(post(validConfirm), { params: { id: ATTEMPT } });
    expect(res.status).toBe(404);
  });

  it("falls back to the zero UUID for the reviewer id in open-access mode", async () => {
    state.session = { adminUserId: ZERO_UUID, role: "super_admin", openAccess: true };
    state.rpc.mockResolvedValue({
      data: [{ ok: true, invoice_id: "inv-1", invoice_status: "paid", subscription_status: "active" }],
      error: null,
    });
    await confirm.POST(post(validConfirm), { params: { id: ATTEMPT } });
    expect(state.rpc).toHaveBeenCalledWith(
      "confirm_subscription_payment",
      expect.objectContaining({ p_admin_id: ZERO_UUID }),
    );
  });

  it("requires a valid rejection code and merchant-safe message", async () => {
    state.session = { adminUserId: "a1", role: "finance_admin" };

    const badCode = await reject.POST(
      post({ expectedVersion: 2, rejectionCode: "made_up", merchantMessage: "no" }),
      { params: { id: ATTEMPT } },
    );
    expect(badCode.status).toBe(400);

    const noMessage = await reject.POST(
      post({ expectedVersion: 2, rejectionCode: "funds_not_found" }),
      { params: { id: ATTEMPT } },
    );
    expect(noMessage.status).toBe(400);
  });

  it("calls reject_subscription_payment with the Akiba 092 parameter shape", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    state.rpc.mockResolvedValue({
      data: [{ ok: true, invoice_id: "inv-1", invoice_status: "issued" }],
      error: null,
    });
    const res = await reject.POST(
      post({
        expectedVersion: 2,
        rejectionCode: "amount_mismatch",
        merchantMessage: "The amount received did not match the invoice.",
      }),
      { params: { id: ATTEMPT } },
    );
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("reject_subscription_payment", {
      p_attempt_id: ATTEMPT,
      p_admin_id: "admin-1",
      p_rejection_code: "amount_mismatch",
      p_rejection_message: "The amount received did not match the invoice.",
      p_expected_version: 2,
      p_allow_override: false,
    });
  });

  it("start-review is limited to finance decision roles", async () => {
    state.session = { adminUserId: "a1", role: "readonly" };
    const res = await startReview.POST(post({ expectedVersion: 1 }), { params: { id: ATTEMPT } });
    expect(res.status).toBe(403);
  });

  it("calls start_subscription_payment_review with attempt id, admin id, version", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    state.rpc.mockResolvedValue({
      data: [{ ok: true, version: 2, invoice_id: "inv-1", partner_id: "p-1" }],
      error: null,
    });
    const res = await startReview.POST(post({ expectedVersion: 1 }), { params: { id: ATTEMPT } });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("start_subscription_payment_review", {
      p_attempt_id: ATTEMPT,
      p_admin_id: "admin-1",
      p_expected_version: 1,
    });
  });

  it("take-over requires a reason and forwards it to the RPC", async () => {
    state.session = { adminUserId: "admin-2", role: "finance_admin" };

    const noReason = await takeOver.POST(post({ expectedVersion: 4 }), { params: { id: ATTEMPT } });
    expect(noReason.status).toBe(400);

    state.rpc.mockResolvedValue({
      data: [{ ok: true, version: 5, invoice_id: "inv-1", previous_reviewer: "admin-1" }],
      error: null,
    });
    const ok = await takeOver.POST(
      post({ expectedVersion: 4, reason: "Original reviewer went offline" }),
      { params: { id: ATTEMPT } },
    );
    expect(ok.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("take_over_subscription_payment_review", {
      p_attempt_id: ATTEMPT,
      p_admin_id: "admin-2",
      p_reason: "Original reviewer went offline",
      p_expected_version: 4,
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "subscription_payment.review_taken_over" }),
    );
  });

  it("evidence-url signs a short-lived link for finance readers", async () => {
    state.session = { adminUserId: "a1", role: "readonly" };
    state.row = {
      evidence_bucket: "subscription-payment-evidence",
      evidence_path: "attempts/x.pdf",
      evidence_content_type: null,
    };
    const res = await evidence.POST(post({}), { params: { id: ATTEMPT } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toContain("https://signed.example");
    expect(body.expiresInSeconds).toBeLessThanOrEqual(300);
  });

  it("evidence-url 404s when no evidence was supplied", async () => {
    state.session = { adminUserId: "a1", role: "finance_admin" };
    state.row = { evidence_bucket: null, evidence_path: null };
    const res = await evidence.POST(post({}), { params: { id: ATTEMPT } });
    expect(res.status).toBe(404);
  });
});
