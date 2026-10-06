import { z } from 'zod';

// Source: hub-page/docs/hub-mobile-app-migration-plan.md,
// "Recommended GET /api/v1/me/bootstrap response".
export const mobileBootstrapSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    displayName: z.string(),
    username: z.string().nullable(),
  }),
  onboarding: z.object({
    complete: z.boolean(),
    needsWalletChoice: z.boolean(),
  }),
  capabilities: z.object({
    quests: z.boolean(),
    nativePush: z.boolean(),
  }),
  // Omitted by the server today — notification_outbox has no read/unread
  // tracking yet (see hub-page's /api/v1/me/bootstrap route). Optional here
  // so the client doesn't break once it's added, instead of requiring a
  // field the API can't honestly provide yet.
  unreadNotificationCount: z.number().int().nonnegative().optional(),
});

export type MobileBootstrap = z.infer<typeof mobileBootstrapSchema>;
