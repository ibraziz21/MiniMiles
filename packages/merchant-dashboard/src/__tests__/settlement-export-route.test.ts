import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/auth", () => ({ requireMerchantSession: async () => state.session }));
vi.mock("@/lib/supabase", () => {
  const result = {
    data: [{
      id: "entry-1", program_id: "program-1", gross_amount_cusd: 10,
      discount_amount_cusd: 2, reimbursement_rate: 1, payable_amount: 2,
      currency: "cUSD", created_at: "2026-06-25T00:00:00Z",
    }],
    error: null,
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (column: string, value: unknown) => { state.filters.push([column, value]); return chain; },
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    then: (resolve: (arg: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return { supabase: { from: () => chain } };
});

const { GET } = await import("@/app/api/merchant/finance/settlements.csv/route");

describe("merchant settlement CSV export", () => {
  beforeEach(() => { state.session = null; state.filters = []; });

  it("requires authentication", async () => {
    const response = await GET(new Request("http://localhost/api/merchant/finance/settlements.csv"));
    expect(response.status).toBe(401);
  });

  it("derives partner isolation from the session and excludes sensitive data", async () => {
    state.session = { partnerId: "partner-session", merchantUserId: "merchant-1" };
    const response = await GET(new Request("http://localhost/api/merchant/finance/settlements.csv"));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(state.filters).toContainEqual(["merchant_id", "partner-session"]);
    expect(csv).not.toContain("user_address");
    expect(csv).not.toContain("rules_snapshot");
    expect(csv).not.toContain("payment_evidence");
  });
});
