/**
 * Publishing an allocation whose participating merchants cannot honour it.
 *
 * The database refuses the transition (Akiba-Platform 156) — this covers what
 * the operator actually reads. A raw `MERCHANT_NOT_READY: …` is not an
 * instruction anyone can act on, so the route re-reads the structured
 * readiness rows and names each merchant and reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: { adminUserId: "admin-1", role: "ops_admin" } as Record<string, unknown> | null,
  transitionError: null as { message: string } | null,
  readiness: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));

const { POST } = await import("@/app/api/admin/voucher-allocations/[allocationId]/publish/route");

function publish() {
  return POST(new NextRequest("https://admin.test/api/admin/voucher-allocations/alloc-1/publish", { method: "POST" }), {
    params: Promise.resolve({ allocationId: "alloc-1" }),
  });
}

describe("POST .../publish — merchant readiness", () => {
  beforeEach(() => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.transitionError = null;
    state.readiness = [];
    state.audit.mockReset();
    state.rpc.mockReset();
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "transition_voucher_funding_allocation_atomic") {
        return { data: state.transitionError ? null : { id: "alloc-1", state: "active" }, error: state.transitionError };
      }
      return { data: state.readiness, error: null };
    });
  });

  it("publishes when the database raises nothing", async () => {
    const res = await publish();
    expect(res.status).toBe(200);
    expect(state.audit).toHaveBeenCalled();
  });

  it("names every unready merchant and its reason", async () => {
    state.transitionError = { message: 'MERCHANT_NOT_READY: Unready Stall (no active merchant subscription...)' };
    state.readiness = [
      { partner_id: "p1", merchant_name: "Arabica Coffee House", is_primary: true, ready: true, reason: null },
      {
        partner_id: "p2",
        merchant_name: "Unready Stall",
        is_primary: false,
        ready: false,
        reason: "no active merchant subscription, so its till cannot redeem or award Miles",
      },
      {
        partner_id: "p3",
        merchant_name: "Shut Shop",
        is_primary: false,
        ready: false,
        reason: "merchant is suspended, not active",
      },
    ];

    const res = await publish();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("Unready Stall");
    expect(body.error).toContain("subscription");
    expect(body.error).toContain("Shut Shop");
    expect(body.error).toContain("suspended");
    // The ready merchant is not blamed.
    expect(body.error).not.toContain("Arabica");
    // Raw database wording never reaches the operator.
    expect(body.error).not.toContain("MERCHANT_NOT_READY");
    // Structured rows too, so the UI can render per-merchant state.
    expect(body.merchants).toHaveLength(3);
    // Nothing was published, so nothing is audited as published.
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("still refuses readably when the readiness re-read returns nothing", async () => {
    state.transitionError = { message: "MERCHANT_NOT_READY: something" };
    state.readiness = [];

    const res = await publish();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/cannot honour this offer yet/i);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("passes other database failures through unchanged", async () => {
    state.transitionError = { message: "ALLOCATION_INVALID_STATE_TRANSITION: publish from draft" };

    const res = await publish();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("requires the publish permission", async () => {
    state.session = null;
    const res = await publish();
    expect(res.status).toBe(401);
  });
});
