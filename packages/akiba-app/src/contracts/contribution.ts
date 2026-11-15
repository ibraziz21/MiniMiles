import { z } from 'zod';

// Source: /api/v1/me/discovery-contributions/* (hub-page
// src/lib/discovery/contributions.ts). The template is the snapshot the
// request was opened with, so the questions never change under a member.
const contributionTemplateSchema = z.object({
  recommendation_prompt: z.string(),
  negative_reason_options: z.array(z.object({ id: z.string(), label: z.string() })),
  party_size_prompt: z.string(),
  item_prompt: z.string(),
  recommendation_item_prompt: z.string(),
  experience_prompt: z.string().nullable(),
  experience_options: z.array(z.object({ id: z.string(), inputLabel: z.string(), publicLabel: z.string() })),
  max_experience_options: z.number(),
  photo_prompt: z.string(),
  photo_safety_guidance: z.string(),
});

const contributionItemSchema = z.object({
  clientItemKey: z.string(),
  rawLabel: z.string(),
  isRecommended: z.boolean(),
});

export const contributionRequestSchema = z.object({
  request: z.object({
    id: z.string(),
    state: z.string(),
    expiresAt: z.string(),
    merchant: z.object({ name: z.string(), slug: z.string().nullable() }),
    template: contributionTemplateSchema,
    contribution: z
      .object({
        id: z.string(),
        wouldRecommend: z.boolean().nullable(),
        negativeReasonId: z.string().nullable(),
        partySize: z.number().nullable(),
        partySizeIsSixPlus: z.boolean(),
        experienceOptionIds: z.array(z.string()),
        privateNote: z.string(),
        items: z.array(contributionItemSchema),
      })
      .nullable(),
  }),
});

export const merchantContributionStatusSchema = z.object({
  // A string, not an enum: a status this build doesn't know reads as "nothing to add yet".
  status: z.string(),
  requestId: z.string().nullable(),
});

export const contributionSubmitResultSchema = z.object({ contributionId: z.string().nullable() });

export type ContributionTemplate = z.infer<typeof contributionTemplateSchema>;
export type ContributionItem = z.infer<typeof contributionItemSchema>;
export type ContributionRequest = z.infer<typeof contributionRequestSchema>['request'];
export type MerchantContributionStatus = z.infer<typeof merchantContributionStatusSchema>;

export type ContributionAnswers = {
  wouldRecommend: boolean | null;
  negativeReasonId: string | null;
  partySize: number | null;
  partySizeIsSixPlus: boolean;
  experienceOptionIds: string[];
  items: (ContributionItem & { source: 'customer_input' })[];
  privateNote?: string;
  idempotencyKey: string;
};
