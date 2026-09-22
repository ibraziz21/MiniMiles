// Shared country resolution/comparison — discovery-blueprint.md §7/§8
// ("acquisition authorization: revalidate country eligibility on the server
// when a voucher is acquired... UI filtering alone must never enforce the
// country lock"). Two independent sides are resolved and compared here so
// every acquisition path (lib/vouchers/issuance.ts, the quote route) shares
// one implementation instead of drifting.
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { normalizeCountry } from "@/lib/akiba/countryCodes";

/**
 * The member's resolved country — moved here from lib/akiba/nextReward.ts
 * (was private to that file) so voucher acquisition can share the exact
 * same resolution instead of reimplementing it. Behavior unchanged:
 * hub_user_profiles.country wins when set, falling back to the legacy
 * wallet-row country otherwise.
 */
export async function resolveMemberCountry(opts: {
  hubUserId: string;
  email: string | null;
  /** Pass the caller's already-resolved legacy country (e.g. home's
   *  resolveHubProfile().activeRow.country) to skip a redundant lookup. */
  legacyCountry?: string | null;
}): Promise<{ code: string | null; name: string | null }> {
  const admin = createAdminClient();
  const [{ data: hubProfile }, legacyCountry] = await Promise.all([
    admin.from("hub_user_profiles").select("country").eq("user_id", opts.hubUserId).maybeSingle(),
    opts.legacyCountry !== undefined
      ? Promise.resolve(opts.legacyCountry)
      : resolveHubProfile({ userId: opts.hubUserId, email: opts.email }).then((p) => p.activeRow?.country ?? null),
  ]);
  const name = hubProfile?.country ?? legacyCountry ?? null;
  return { code: normalizeCountry(name), name };
}

/** The merchant's country, normalized the same way as the member's side so
 *  the two are actually comparable regardless of which raw format either
 *  was stored in. */
export async function resolveMerchantCountry(merchantId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("partners").select("country").eq("id", merchantId).maybeSingle();
  return normalizeCountry(data?.country ?? null);
}

export type CountryEligibility = {
  eligible: boolean;
  memberCountry: string | null;
  merchantCountry: string | null;
};

/**
 * Fails open when either side is unknown — only blocks when both countries
 * are resolved and they actually disagree. This is a security/eligibility
 * gate, not a ranking signal, but blocking on incomplete data would lock
 * legitimate merchants/members out of checkout for a data-completeness gap
 * rather than a real country mismatch; data completeness for
 * `partners.country` has not been verified.
 */
export function evaluateCountryEligibility(
  memberCountryCode: string | null,
  merchantCountryRaw: string | null
): CountryEligibility {
  const merchantCountry = normalizeCountry(merchantCountryRaw);
  const eligible = memberCountryCode === null || merchantCountry === null || memberCountryCode === merchantCountry;
  return { eligible, memberCountry: memberCountryCode, merchantCountry };
}
