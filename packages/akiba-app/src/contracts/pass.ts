import { z } from 'zod';

// Source: hub-page's GET /api/v1/me/pass (src/app/api/v1/me/pass/route.ts).
export const mobilePassSchema = z.object({
  publicPassId: z.string(),
  qrPayload: z.string(),
  displayName: z.string(),
  email: z.string(),
});

export type MobilePass = z.infer<typeof mobilePassSchema>;

// Source: POST /api/v1/me/pass/token. The merchant scanner accepts this
// short-lived presentation token; the stable payload above is retained for
// identity/recovery but is not presented as the primary in-store code.
export const passPresentationSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
});

export type PassPresentation = z.infer<typeof passPresentationSchema>;
