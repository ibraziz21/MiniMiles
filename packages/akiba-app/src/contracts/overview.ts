import { z } from 'zod';

// Source: hub-page's GET /api/v1/me/overview (src/app/api/v1/me/overview/route.ts),
// re-read directly to confirm field names rather than assumed from memory.
export const activityItemSchema = z.object({
  id: z.string(),
  ts: z.number(),
  kind: z.enum([
    'daily_quest',
    'partner_quest',
    'bonus',
    'voucher_grant',
    'voucher_redeem',
    'merchant_award',
    'miles_spent',
    'skill_game_reward',
  ]),
  title: z.string(),
  detail: z.string().nullable(),
  miles: z.number().nullable(),
});

export type ActivityItem = z.infer<typeof activityItemSchema>;

export const savedMerchantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  savedAt: z.string(),
});

export type SavedMerchant = z.infer<typeof savedMerchantSchema>;

export const verifiedDiscoveryHighlightSchema = z.object({
  merchantId: z.string(),
  merchantSlug: z.string(),
  merchantName: z.string(),
  verifiedRecommendationBand: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('new') }),
    z.object({ kind: z.literal('exact'), count: z.number() }),
  ]),
  lovedLabels: z.array(z.string()),
  recommendedItems: z.array(z.string()),
  photo: z.object({
    id: z.string(),
    thumbnailUrl: z.string(),
    displayUrl: z.string(),
    altText: z.string(),
  }),
});

export type VerifiedDiscoveryHighlight = z.infer<typeof verifiedDiscoveryHighlightSchema>;

export const ownedVoucherPreviewSchema = z.object({
  id: z.string(),
  status: z.enum(['issued', 'pending', 'claiming']),
  title: z.string(),
  valueLabel: z.string(),
  merchantName: z.string(),
  merchantLogoUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export type OwnedVoucherPreview = z.infer<typeof ownedVoucherPreviewSchema>;

export const mobileOverviewSchema = z.object({
  profile: z.object({
    displayName: z.string(),
    username: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    email: z.string().nullable(),
    walletAddress: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    needsWalletChoice: z.boolean(),
  }),
  balance: z.object({
    chainBalance: z.number(),
    ledgerBalance: z.number(),
    balance: z.number(),
    hasBalance: z.boolean(),
  }),
  stats: z.object({
    placesVisited: z.number(),
    rewardsUsed: z.number(),
  }),
  activity: z.array(activityItemSchema),
  savedMerchants: z.array(savedMerchantSchema),
  verifiedPlaces: z.array(verifiedDiscoveryHighlightSchema),
  voucherPreview: z.object({
    items: z.array(ownedVoucherPreviewSchema),
    totalCount: z.number(),
  }),
});

export type MobileOverview = z.infer<typeof mobileOverviewSchema>;
