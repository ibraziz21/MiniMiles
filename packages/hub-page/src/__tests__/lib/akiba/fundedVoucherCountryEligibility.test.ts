import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allocation: { voucher_funding_programs: { country_code: "KE" } } as
    | { voucher_funding_programs: { country_code: string | null } | null }
    | null,
  memberCountry: "KE" as string | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "hub_user_profiles"
              ? { data: { country_code: state.memberCountry }, error: null }
              : { data: state.allocation, error: null },
        }),
      }),
    }),
  }),
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

    expect(result).toEqual({
      ok: true,
      eligible: false,
      fundCountry: "KE",
      memberCountry: "UG",
      reasonCode: "profile_country_mismatch",
    });
  });

  it("fails closed when the member country is missing", async () => {
    state.memberCountry = null;

    const result = await evaluateFundedVoucherCountryEligibility({
      allocationId: "alloc-1",
      hubUserId: "user-1",
      email: null,
    });

    expect(result).toEqual({
      ok: true,
      eligible: false,
      fundCountry: "KE",
      memberCountry: null,
      reasonCode: "profile_country_required",
    });
  });
});
