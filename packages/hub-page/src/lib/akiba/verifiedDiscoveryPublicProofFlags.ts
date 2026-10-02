// Independent public-proof kill switches for verified discovery
// (verified-discovery-market-readiness-hardening-spec.md §0.1, §1: "a
// feature kill switch must hide the affected public proof surface without
// disabling merchant search, merchant profiles, Miles or vouchers" and
// "independent flags can disable contribution entry, public customer
// photos, merchant-page verified visits and the Discovery spotlight").
//
// Unlike lib/akiba/discoveryContributionsRollout.ts (a gradual, opt-in
// rollout gate for a *new* flow, so it defaults OFF), these three surfaces
// are already live pilot features — each flag here defaults ON and exists
// only to let Operations hide one surface during an incident without a
// deploy. Same injectable-env shape as every other rollout/flag module in
// this codebase for testability.
type FlagEnvironment = {
  [key: string]: string | undefined;
  HUB_DISCOVERY_SPOTLIGHT_ENABLED?: string;
  HUB_DISCOVERY_VERIFIED_VISITS_PUBLIC_ENABLED?: string;
  HUB_DISCOVERY_CUSTOMER_PHOTOS_PUBLIC_ENABLED?: string;
};

function isFalsy(value?: string): boolean {
  return ["0", "false", "no", "off"].includes(value?.trim().toLowerCase() ?? "");
}

/** Home/Discovery verified-photo spotlight (lib/home/verifiedDiscovery.ts). */
export function isDiscoverySpotlightEnabled(env: FlagEnvironment = process.env): boolean {
  return !isFalsy(env.HUB_DISCOVERY_SPOTLIGHT_ENABLED);
}

/** Merchant-page "Verified visits" cards (lib/merchants/queries.ts). */
export function isVerifiedVisitsPublicEnabled(env: FlagEnvironment = process.env): boolean {
  return !isFalsy(env.HUB_DISCOVERY_VERIFIED_VISITS_PUBLIC_ENABLED);
}

/** Public customer-photo galleries (lib/merchants/queries.ts). */
export function isCustomerPhotosPublicEnabled(env: FlagEnvironment = process.env): boolean {
  return !isFalsy(env.HUB_DISCOVERY_CUSTOMER_PHOTOS_PUBLIC_ENABLED);
}

/** Current state of all three switches, for health/ops reporting. */
export function getVerifiedDiscoveryPublicProofFlagsSummary(env: FlagEnvironment = process.env) {
  return {
    spotlightEnabled: isDiscoverySpotlightEnabled(env),
    verifiedVisitsPublicEnabled: isVerifiedVisitsPublicEnabled(env),
    customerPhotosPublicEnabled: isCustomerPhotosPublicEnabled(env),
  };
}
