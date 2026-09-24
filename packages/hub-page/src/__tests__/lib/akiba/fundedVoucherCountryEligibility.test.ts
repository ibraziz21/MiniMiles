import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allocation: { voucher_funding_programs: { country_code: "KE" } } as
    | { voucher_funding_programs: { country_code: string | null } | null }
    | null,
  memberCountry: "KE" as string | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.allocation, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/akiba/countryEligibility", () => ({
  resolveMemberCountry: async () => ({ code: state.memberCountry, name: state.memberCountry }),
}));

const { evaluateFundedVoucherCountryEligibility } = await import(
  "@/lib/akiba/fundedVoucherCountryEligibility"
);

describe("evaluateFundedVoucherCountryEligibility", () => {
  beforeEach(() => {
    state.allocation = { voucher_funding_programs: { country_code: "KE" } };
    state.memberCountry = "KE";
  });

  it("allows a Kenyan member into a Kenyan fund", async () => {
    const result = await evaluateFundedVoucherCountryEligibility({
      allocationId: "alloc-1",
      hubUserId: "user-1",
      email: null,
    });

    expect(result).toEqual({ ok: true, eligible: true, fundCountry: "KE", memberCountry: "KE" });
  });

  it("rejects a member from another country", async () => {
    state.memberCountry = "UG";

    const result = await evaluateFundedVoucherCountryEligibility({
      allocationId: "alloc-1",
      hubUserId: "user-1",
      email: null,
    });

    expect(result).toEqual({ ok: true, eligible: false, fundCountry: "KE", memberCountry: "UG" });
  });

  it("fails closed when the member country is missing", async () => {
    state.memberCountry = null;

    const result = await evaluateFundedVoucherCountryEligibility({
      allocationId: "alloc-1",
      hubUserId: "user-1",
      email: null,
    });

    expect(result).toEqual({ ok: true, eligible: false, fundCountry: "KE", memberCountry: null });
  });
});
