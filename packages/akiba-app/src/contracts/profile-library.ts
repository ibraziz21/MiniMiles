import { z } from 'zod';
import { savedMerchantSchema, activityItemSchema } from './overview';
import { memberVerifiedVisitSchema } from './merchant-detail';

export const profileActivitySchema = z.object({ items: z.array(activityItemSchema), limit: z.number() });
export const profileShareSchema = memberVerifiedVisitSchema.extend({
  publiclyVisible: z.boolean(),
  merchantName: z.string(), merchantSlug: z.string(), merchantLogoUrl: z.string().nullable(),
  items: z.array(z.string()), experienceLabels: z.array(z.string()),
  photos: z.array(z.object({ id: z.string(), url: z.string().nullable(), status: z.string() })),
});
export const profileSharesSchema = z.object({
  shares: z.array(profileShareSchema), nextOffset: z.number().nullable(),
  opportunities: z.array(z.object({ id: z.string(), merchantName: z.string(), merchantSlug: z.string(), expiresAt: z.string() })),
});
export type ProfileShare = z.infer<typeof profileShareSchema>;
export type ProfileShares = z.infer<typeof profileSharesSchema>;

export const savedPlacesSchema = z.object({ places: z.array(savedMerchantSchema), nextOffset: z.number().nullable() });
