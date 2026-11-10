import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  count: 0 as number | null,
  error: null as object | null,
  tables: [] as string[],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      state.tables.push(table);
      const q: any = {
        select: () => q,
        eq: () => q,
        not: () => q,
        gte: () => q,
        maybeSingle: async () => ({
          data: { template_key: "test" },
          error: state.error,
        }),
        then: (resolve: any) =>
          Promise.resolve({ count: state.count, error: state.error }).then(
            resolve
          ),
      };
      return q;
    },
  },
}));
vi.mock("@/lib/voucherUsername", () => ({
  resolveVoucherRecipientUsername: vi.fn(),
  USERNAME_ERROR_MESSAGES: {},
}));
import { evaluateGrantRule } from "@/lib/voucherGrantEligibility";
const member = { hubUserId: "hub", canonicalId: "canonical" };
describe("grant preview rules", () => {
  beforeEach(() => {
    state.count = 0;
    state.error = null;
    state.tables = [];
  });
  it.each([
    "first_funded_voucher",
    "no_prior_merchant_redemption",
    "fund_claim_cooldown",
  ])("does not treat failed %s lookup as no history", async (type) => {
    state.error = { message: "offline" };
    await expect(
      evaluateGrantRule({ type, days: 7 }, member, "merchant", "KE")
    ).rejects.toThrow();
  });
  it("checks registered verified activity instead of raw events", async () => {
    state.count = 1;
    expect(
      await evaluateGrantRule(
        { type: "verified_activity_completed", templateKey: "test" },
        member,
        "merchant",
        "KE"
      )
    ).toBe(true);
    expect(state.tables).toEqual(["verification_templates", "verifications"]);
  });
  it("refuses unsupported historical restrictions", async () => {
    await expect(
      evaluateGrantRule({ type: "not_blocked" }, member, "merchant", "KE")
    ).rejects.toThrow();
  });
  it("refuses malformed country policy even in an any policy", async () => {
    await expect(
      evaluateGrantRule(
        { type: "country_in", countries: [] },
        member,
        "merchant",
        "KE"
      )
    ).rejects.toThrow();
  });
  it("evaluates an explicit local weekday list", async () => {
    expect(
      await evaluateGrantRule(
        {
          type: "claim_day_of_week",
          days: [0, 1, 2, 3, 4, 5, 6],
          timezone: "Africa/Nairobi",
        },
        member,
        "merchant",
        "KE"
      )
    ).toBe(true);
  });
});
