// Static/env-resolved values for GET /api/v1/config (version gate + legal
// links). Same env-injectable pattern as featureFlags.server.ts so tests can
// override process.env per call instead of relying on a cached snapshot.
import { DELETION_POLICY_VERSION } from "@/lib/akiba/accountDeletionPolicy";

type ConfigEnvironment = { [key: string]: string | undefined };

export type VersionGate = {
  minimumSupportedVersion: { ios: string; android: string };
  latestVersion: { ios: string; android: string };
  maintenance: boolean;
};

/**
 * Where "Update Akiba Pass" sends a member whose build is below
 * `minimumSupportedVersion`. Env-driven and nullable because the store
 * listings don't exist yet (app.json's bundle identifiers are still
 * flagged as placeholders) — the native upgrade screen renders
 * store-neutral instructions rather than a dead button when a platform's
 * URL is absent, so publishing the field early can't ship a broken CTA.
 */
export type StoreLinks = {
  ios: string | null;
  android: string | null;
};

export type LegalLinks = {
  privacyUrl: string;
  termsUrl: string;
  /**
   * Version of the account-deletion copy and retention map the member is
   * shown (AKIBA-MOB-002 §7). The app echoes it back as `policyVersion` when
   * submitting a request, and the request API accepts only the currently
   * active value — so an older binary showing superseded copy is rejected
   * rather than silently recording consent to terms the member never read.
   */
  deletionPolicyVersion: string;
  /**
   * The public account-deletion page (AKIBA-MOB-002 §6). Google Play requires
   * this URL to resolve to a working, unauthenticated resource, and it is
   * also usable as Apple's optional User Privacy Choices URL.
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
    deletionPolicyVersion: DELETION_POLICY_VERSION,
  };
}

export function getStoreLinks(env: ConfigEnvironment = process.env): StoreLinks {
  return {
    ios: env.MOBILE_STORE_URL_IOS?.trim() || null,
    android: env.MOBILE_STORE_URL_ANDROID?.trim() || null,
  };
}
