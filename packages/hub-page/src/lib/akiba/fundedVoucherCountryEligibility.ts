import { normalizeCountry } from "@/lib/akiba/countryCodes";
import { resolveMemberCountry } from "@/lib/akiba/countryEligibility";
import { createAdminClient } from "@/lib/supabase/admin";

export type FundedVoucherCountryEligibility =
  | {
      ok: true;
      eligible: boolean;
      fundCountry: string;
      memberCountry: string | null;
    }
  | { ok: false; reason: "allocation_not_found" | "country_policy_unavailable" };

/**
 * Strict country gate for Akiba-funded vouchers. Unlike ordinary marketplace
 * discovery, an unknown member country fails closed because Akiba is funding
 * the inventory for one specific program country.
 */
export async function evaluateFundedVoucherCountryEligibility(opts: {
  allocationId: string;
  hubUserId: string;
  email: string | null;
}): Promise<FundedVoucherCountryEligibility> {
  const admin = createAdminClient();
  const [allocationResult, memberCountry] = await Promise.all([
    admin
      .from("voucher_funding_allocations")
      .select("voucher_funding_programs(country_code)")
      .eq("id", opts.allocationId)
      .maybeSingle(),
    resolveMemberCountry({ hubUserId: opts.hubUserId, email: opts.email }),
  ]);

  if (allocationResult.error || !allocationResult.data) {
    return { ok: false, reason: "allocation_not_found" };
  }

  const program = allocationResult.data.voucher_funding_programs as unknown as
    | { country_code: string | null }
    | null;
  const fundCountry = normalizeCountry(program?.country_code);
  if (!fundCountry) return { ok: false, reason: "country_policy_unavailable" };

  return {
    ok: true,
    eligible: memberCountry.code === fundCountry,
    fundCountry,
    memberCountry: memberCountry.code,
  };
}
