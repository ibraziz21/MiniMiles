import { normalizeCountry } from "@/lib/akiba/countryCodes";
import { createAdminClient } from "@/lib/supabase/admin";

export type FundedVoucherCountryEligibility =
  | {
      ok: true;
      eligible: boolean;
      fundCountry: string;
      memberCountry: string | null;
      /** Only set when ineligible — distinguishes an unset profile (member
       *  can fix it) from a mismatched one (spec §9.1/§11). */
      reasonCode?: "profile_country_required" | "profile_country_mismatch";
    }
  | { ok: false; reason: "allocation_not_found" | "country_policy_unavailable" };

/**
 * Reads only the exact member's `hub_user_profiles.country_code` — never a
 * canonical identity's other linked accounts and never a legacy wallet
 * country. This is the dedicated strict resolver required by
 * akiba-funded-voucher-profile-country-eligibility-spec.md §8.3: funded
 * discovery/eligibility/claim must not call the ordinary marketplace
 * `resolveMemberCountry` helper, which still falls back to legacy data for
 * non-funded vouchers.
 */
async function resolveFundedVoucherProfileCountry(hubUserId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hub_user_profiles")
    .select("country_code")
    .eq("user_id", hubUserId)
    .maybeSingle();
  return data?.country_code ?? null;
}

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
    resolveFundedVoucherProfileCountry(opts.hubUserId),
  ]);

  if (allocationResult.error || !allocationResult.data) {
    return { ok: false, reason: "allocation_not_found" };
  }

  const program = allocationResult.data.voucher_funding_programs as unknown as
    | { country_code: string | null }
    | null;
  const fundCountry = normalizeCountry(program?.country_code);
  if (!fundCountry) return { ok: false, reason: "country_policy_unavailable" };

  const eligible = memberCountry === fundCountry;
  return {
    ok: true,
    eligible,
    fundCountry,
    memberCountry,
    ...(eligible
      ? {}
      : { reasonCode: memberCountry === null ? "profile_country_required" : "profile_country_mismatch" as const }),
  };
}
