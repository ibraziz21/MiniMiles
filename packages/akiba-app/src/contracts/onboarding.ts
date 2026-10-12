import { z } from 'zod';

// Source: hub-page's POST /api/v1/me/onboarding/complete. `completedAt` is
// the *first* completion's timestamp — the route never refreshes it — so a
// repeat call is safe and returns the original value.
export const onboardingCompletionSchema = z.object({
  complete: z.literal(true),
  completedAt: z.string(),
});

export type OnboardingCompletion = z.infer<typeof onboardingCompletionSchema>;
