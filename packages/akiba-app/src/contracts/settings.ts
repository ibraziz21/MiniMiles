import { z } from 'zod';

// Source: hub-page's GET /api/v1/me/settings
// (src/app/api/v1/me/settings/route.ts). The wallets array in the real
// response is intentionally not modeled here — akiba-app is fully web2
// (see the no-wallet project memory) and never renders wallet-management
// UI, so there's nothing for a typed field to feed.
export const mobileSettingsSchema = z.object({
  profile: z.object({
    displayName: z.string(),
    username: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    email: z.string().nullable(),
    country: z.string().nullable(),
    city: z.string().nullable(),
    phone: z.string().nullable(),
  }),
});

export type MobileSettings = z.infer<typeof mobileSettingsSchema>;

export const settingsUpdateSchema = z.object({
  ok: z.literal(true),
  username: z.string().optional(),
  phone: z.string().nullable().optional(),
  country: z.string().optional(),
  city: z.string().nullable().optional(),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
