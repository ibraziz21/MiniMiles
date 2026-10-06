import { z } from 'zod';

import { merchantValueSummarySchema } from './merchants';

// Source: hub-page's GET /api/v1/home (src/app/api/v1/home/route.ts) —
// `feed` passes through hub-page's HomeFeedResponse unchanged, `cities` and
// `member` are added by the route itself.
const discoveryIntentSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  iconKey: z.string(),
  query: z.string(),
  categorySlug: z.string().optional(),
  active: z.boolean(),
  sortOrder: z.number(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

const homeFeedSectionSchema = z.object({
  id: z.enum(['for_you', 'nearby', 'popular', 'new', 'limited_time']),
  title: z.string(),
  personalized: z.boolean(),
  merchants: z.array(merchantValueSummarySchema),
});

const verifiedDiscoveryHighlightSchema = z.object({
  merchantId: z.string(),
  merchantSlug: z.string(),
  merchantName: z.string(),
  verifiedRecommendationBand: z.union([
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

const homeFeedSchema = z.object({
  rankingVersion: z.string(),
  generatedAt: z.string(),
  intents: z.array(discoveryIntentSchema),
  sections: z.array(homeFeedSectionSchema),
  verifiedHighlights: z.array(verifiedDiscoveryHighlightSchema),
  rewards: z
    .object({
      milesBalance: z.number(),
      continueVoucher: z.unknown().nullable(),
    })
    .nullable(),
  nextReward: z.unknown().nullable(),
});

export const mobileHomeSchema = z.object({
  feed: homeFeedSchema,
  cities: z.array(z.string()),
  member: z
    .object({
      displayName: z.string(),
      nextDiscoveryContribution: z.unknown().nullable(),
    })
    .nullable(),
});

export type MobileHome = z.infer<typeof mobileHomeSchema>;
