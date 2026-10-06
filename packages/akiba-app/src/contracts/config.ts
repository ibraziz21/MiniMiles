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
  }),
  legal: z.object({
    privacyUrl: z.string().url(),
    termsUrl: z.string().url(),
    accountDeletionUrl: z.string().url(),
  }),
});

export type MobileConfig = z.infer<typeof mobileConfigSchema>;
