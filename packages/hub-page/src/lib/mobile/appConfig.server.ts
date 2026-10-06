// Static/env-resolved values for GET /api/v1/config (version gate + legal
// links). Same env-injectable pattern as featureFlags.server.ts so tests can
// override process.env per call instead of relying on a cached snapshot.
type ConfigEnvironment = { [key: string]: string | undefined };

export type VersionGate = {
  minimumSupportedVersion: { ios: string; android: string };
  latestVersion: { ios: string; android: string };
  maintenance: boolean;
};

export type LegalLinks = {
  privacyUrl: string;
  termsUrl: string;
  /**
   * The account-deletion request page is a store-policy requirement but
   * doesn't exist yet (hub-mobile-app-migration-plan.md §"Decisions still
   * required from the team" #6 — retention policy is undecided). This URL
   * is published so the contract shape is final, but it 404s until that
   * page ships; building it is explicitly out of scope for this round.
   */
  accountDeletionUrl: string;
};

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function getVersionGate(env: ConfigEnvironment = process.env): VersionGate {
  return {
    minimumSupportedVersion: {
      ios: env.MOBILE_MIN_VERSION_IOS?.trim() || "1.0.0",
      android: env.MOBILE_MIN_VERSION_ANDROID?.trim() || "1.0.0",
    },
    latestVersion: {
      ios: env.MOBILE_LATEST_VERSION_IOS?.trim() || "1.0.0",
      android: env.MOBILE_LATEST_VERSION_ANDROID?.trim() || "1.0.0",
    },
    maintenance: isTruthy(env.MOBILE_MAINTENANCE_MODE),
  };
}

export function getLegalLinks(siteUrl: string, env: ConfigEnvironment = process.env): LegalLinks {
  return {
    privacyUrl: `${siteUrl}/privacy-policy`,
    termsUrl: `${siteUrl}/terms-of-use`,
    accountDeletionUrl: env.MOBILE_ACCOUNT_DELETION_URL?.trim() || `${siteUrl}/account-deletion`,
  };
}
