// Device-registration domain logic, kept out of the route so the validation
// rules are unit-testable without constructing Requests.
import type { SupabaseClient } from "@supabase/supabase-js";

export type DevicePlatform = "ios" | "android";

export type DeviceRegistrationInput = {
  installationId: string;
  platform: DevicePlatform;
  expoPushToken: string;
  appVersion: string | null;
  buildNumber: string | null;
  locale: string | null;
  timezone: string | null;
};

export type DeviceRegistrationProblem =
  | "invalid_installation_id"
  | "invalid_platform"
  | "invalid_push_token"
  | "invalid_metadata";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Expo mints both spellings depending on SDK version; accept either and
// nothing else, so a raw APNs/FCM token can't be stored in the Expo column
// and silently fail to send later.
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

const MAX_METADATA_LENGTH = 64;

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_METADATA_LENGTH) return undefined;
  return trimmed;
}

/**
 * Validates a registration body. Returns the normalised input, or the first
 * problem found so the route can map it to a stable error code.
 */
export function parseDeviceRegistration(
  body: Record<string, unknown> | null,
): { ok: true; input: DeviceRegistrationInput } | { ok: false; problem: DeviceRegistrationProblem } {
  if (!body) return { ok: false, problem: "invalid_installation_id" };

  const installationId = typeof body.installationId === "string" ? body.installationId.trim() : "";
  if (!UUID_RE.test(installationId)) return { ok: false, problem: "invalid_installation_id" };

  const platform = body.platform;
  if (platform !== "ios" && platform !== "android") return { ok: false, problem: "invalid_platform" };

  const expoPushToken = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : "";
  if (!EXPO_TOKEN_RE.test(expoPushToken)) return { ok: false, problem: "invalid_push_token" };

  const appVersion = optionalString(body.appVersion);
  const buildNumber = optionalString(body.buildNumber);
  const locale = optionalString(body.locale);
  const timezone = optionalString(body.timezone);
  if (appVersion === undefined || buildNumber === undefined || locale === undefined || timezone === undefined) {
    return { ok: false, problem: "invalid_metadata" };
  }

  return {
    ok: true,
    input: { installationId, platform, expoPushToken, appVersion, buildNumber, locale, timezone },
  };
}

/**
 * Idempotent registration.
 *
 * Two different uniqueness rules are in play and both matter:
 *  - (hub_user_id, installation_id) — the same install re-registering after
 *    its token rotated must update that row, not add a second one.
 *  - expo_push_token — a token can be handed to a *different* account (same
 *    phone, new sign-in). The old owner's row must give the token up, or
 *    this member's notifications would be sent to a row still filed under
 *    the previous account and the unique constraint would reject the write.
 *
 * Releasing the token elsewhere first is what makes the upsert below safe,
 * and it is deliberately scoped to other users' rows so it cannot clobber
 * the row this upsert is about to target.
 */
export async function registerDevice(
  admin: SupabaseClient,
  hubUserId: string,
  input: DeviceRegistrationInput,
): Promise<{ ok: true; deviceId: string } | { ok: false; error: string }> {
  const releaseError = await releaseTokenFromOtherUsers(admin, hubUserId, input.expoPushToken);
  if (releaseError) return { ok: false, error: releaseError };

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("hub_user_devices")
    .upsert(
      {
        hub_user_id: hubUserId,
        installation_id: input.installationId,
        platform: input.platform,
        expo_push_token: input.expoPushToken,
        app_version: input.appVersion,
        build_number: input.buildNumber,
        locale: input.locale,
        timezone: input.timezone,
        status: "active",
        failure_count: 0,
        last_seen_at: now,
        revoked_at: null,
      },
      { onConflict: "hub_user_id,installation_id" },
    )
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: "registration returned no row" };
  return { ok: true, deviceId: data.id as string };
}

async function releaseTokenFromOtherUsers(
  admin: SupabaseClient,
  hubUserId: string,
  expoPushToken: string,
): Promise<string | null> {
  const { error } = await admin
    .from("hub_user_devices")
    .update({
      expo_push_token: null,
      native_device_token: null,
      status: "revoked",
      revoked_at: new Date().toISOString(),
    })
    .eq("expo_push_token", expoPushToken)
    .neq("hub_user_id", hubUserId);

  return error ? error.message : null;
}

/** Revokes this member's registration for one installation. */
export async function revokeDevice(
  admin: SupabaseClient,
  hubUserId: string,
  installationId: string,
): Promise<{ ok: true; revoked: number } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("hub_user_devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("hub_user_id", hubUserId)
    .eq("installation_id", installationId)
    .neq("status", "revoked")
    .select("id");

  if (error) return { ok: false, error: error.message };
  return { ok: true, revoked: data?.length ?? 0 };
}

export function isValidInstallationId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}
