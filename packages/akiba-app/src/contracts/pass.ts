import { z } from 'zod';

// Source: hub-page's GET /api/v1/me/pass (src/app/api/v1/me/pass/route.ts).
// Stable pass ID only — the rotating presentation token depends on
// POST /api/v1/me/pass/token, which doesn't exist yet.
export const mobilePassSchema = z.object({
  publicPassId: z.string(),
  qrPayload: z.string(),
  displayName: z.string(),
  email: z.string(),
});

export type MobilePass = z.infer<typeof mobilePassSchema>;
