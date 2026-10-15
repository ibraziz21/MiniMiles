import { z } from 'zod';

import { merchantOfferSchema } from './merchant-detail';

export const merchantOfferFeedItemSchema = merchantOfferSchema.extend({
  partner: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logoUrl: z.string().nullable(),
  }),
  thumbnailUrl: z.string().nullable(),
});

export const merchantOfferFeedSchema = z.object({
  offers: z.array(merchantOfferFeedItemSchema),
});

export type MerchantOfferFeedItem = z.infer<typeof merchantOfferFeedItemSchema>;
export type MerchantOfferFeed = z.infer<typeof merchantOfferFeedSchema>;
