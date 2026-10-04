// Independent public-proof kill switches for verified discovery
// (verified-discovery-market-readiness-hardening-spec.md §0.1, §1: "a
// feature kill switch must hide the affected public proof surface without
// disabling merchant search, merchant profiles, Miles or vouchers" and
// "independent flags can disable contribution entry, public customer
// photos, merchant-page verified visits and the Discovery spotlight").
//
// Production is fail-closed: every surface must be explicitly enabled.
// Development and tests remain enabled by default so local work does not
// require a full production environment. Any configured but unrecognized
// value is treated as disabled.
type FlagEnvironment = {
  [key: string]: string | undefined;
  HUB_DISCOVERY_SPOTLIGHT_ENABLED?: string;
  HUB_DISCOVERY_VERIFIED_VISITS_PUBLIC_ENABLED?: string;
  HUB_DISCOVERY_CUSTOMER_PHOTOS_PUBLIC_ENABLED?: string;
  HUB_DISCOVERY_SNAPSHOT_READ_ENABLED?: string;
  NODE_ENV?: string;
};

function isEnabled(value: string | undefined, env: FlagEnvironment): boolean {
  if (value === undefined || value.trim() === "") return env.NODE_ENV !== "production";
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/** Home/Discovery verified-photo spotlight (lib/home/verifiedDiscovery.ts). */
export function isDiscoverySpotlightEnabled(env: FlagEnvironment = process.env): boolean {
  return isEnabled(env.HUB_DISCOVERY_SPOTLIGHT_ENABLED, env);
}

/** Merchant-page "Verified visits" cards (lib/merchants/queries.ts). */
export function isVerifiedVisitsPublicEnabled(env: FlagEnvironment = process.env): boolean {
  return isEnabled(env.HUB_DISCOVERY_VERIFIED_VISITS_PUBLIC_ENABLED, env);
}

/** Public customer-photo galleries (lib/merchants/queries.ts). */
export function isCustomerPhotosPublicEnabled(env: FlagEnvironment = process.env): boolean {
  return isEnabled(env.HUB_DISCOVERY_CUSTOMER_PHOTOS_PUBLIC_ENABLED, env);
}

/** Full-corpus Discovery snapshot cutover. Always opt-in, even outside production. */
export function isDiscoverySnapshotReadEnabled(env: FlagEnvironment = process.env): boolean {
  return isExplicitlyEnabled(env.HUB_DISCOVERY_SNAPSHOT_READ_ENABLED);
}

/** Current state of all three switches, for health/ops reporting. */
export function getVerifiedDiscoveryPublicProofFlagsSummary(env: FlagEnvironment = process.env) {
  return {
    spotlightEnabled: isDiscoverySpotlightEnabled(env),
    verifiedVisitsPublicEnabled: isVerifiedVisitsPublicEnabled(env),
    customerPhotosPublicEnabled: isCustomerPhotosPublicEnabled(env),
    snapshotReadEnabled: isDiscoverySnapshotReadEnabled(env),
  };
}
