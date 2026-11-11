import { z } from 'zod';

// POST / DELETE /api/v1/me/devices and GET / PATCH
// /api/v1/me/notification-preferences (hub-mobile-app-migration-plan.md
// P1 "Native push").

export const deviceRegistrationSchema = z.object({
  registered: z.boolean(),
  // Present on a successful registration; a revocation response omits it.
  deviceId: z.string().optional(),
  revoked: z.number().int().nonnegative().optional(),
});

// Source: POST /api/v1/me/devices/test-push (hub-page src/lib/push/testPush.ts).
export const testPushResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('push_disabled') }),
  z.object({ status: z.literal('no_devices') }),
  z.object({ status: z.literal('sent'), devices: z.number(), accepted: z.number(), errors: z.array(z.string()) }),
  z.object({ status: z.literal('failed'), devices: z.number(), errors: z.array(z.string()) }),
]);

export const notificationPreferencesSchema = z.object({
  preferences: z.object({
    orders: z.boolean(),
    vouchers: z.boolean(),
    rewards: z.boolean(),
    marketing: z.boolean(),
    earnings: z.boolean(),
  }),
});

export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;
export type TestPushResult = z.infer<typeof testPushResultSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationCategory = keyof NotificationPreferences['preferences'];
