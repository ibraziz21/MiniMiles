import { z } from 'zod';

// Source: hub-page/docs/hub-mobile-app-migration-plan.md,
// "Version and force-upgrade contract".
const platformVersionsSchema = z.object({
  ios: z.string(),
  android: z.string(),
});

export const mobileConfigSchema = z.object({
  minimumSupportedVersion: platformVersionsSchema,
  latestVersion: platformVersionsSchema,
  maintenance: z.boolean(),
  features: z.object({
    walletLinking: z.boolean(),
    offlinePass: z.boolean(),
    hubQuestClaims: z.boolean(),
    akibaFundedVouchers: z.boolean(),
    quests: z.boolean(),
    discoveryContributions: z.boolean(),
    milesEarnedNotifications: z.boolean(),
    // Gates the Gifts tab, which is a coming-soon placeholder until the
    // gifting vertical ships (AKIBA-MOB-001 §1). Defaulted rather than
    // required so an app build running against a hub-page deployment that
    // predates the flag fails safe — hidden — instead of refusing to
    // launch on a schema error.
    gifts: z.boolean().default(false),
  }),
  legal: z.object({
    privacyUrl: z.string().url(),
    termsUrl: z.string().url(),
    accountDeletionUrl: z.string().url(),
    // Version of the deletion copy and retention map this build shows
    // (AKIBA-MOB-002 §7). Echoed back when submitting a request; the server
    // accepts only its own current value, so a stale binary is rejected
    // instead of recording consent to terms the member never saw. Defaulted
    // for the same deployment-skew reason as the fields below — an empty
    // version is rejected by the request API, which is the safe direction.
    deletionPolicyVersion: z.string().default(''),
  }),
  // Where "Update Akiba Pass" sends a member on a build below
  // minimumSupportedVersion. Nullable per platform because the store
  // listings don't exist yet — the upgrade screen falls back to
  // store-neutral instructions rather than rendering a dead button.
  // Defaulted for the same deployment-skew reason as `gifts`: with no URL
  // the upgrade screen shows store-neutral instructions, which is the
  // behaviour an absent field should produce anyway.
  storeUrl: z
    .object({
      ios: z.string().url().nullable(),
      android: z.string().url().nullable(),
    })
    .default({ ios: null, android: null }),
});

export type MobileConfig = z.infer<typeof mobileConfigSchema>;
export type MobileFeatureFlags = MobileConfig['features'];
