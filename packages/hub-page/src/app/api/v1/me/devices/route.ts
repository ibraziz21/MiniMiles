// POST / DELETE /api/v1/me/devices — native push device registration
// (hub-mobile-app-migration-plan.md "Existing mutation routes to version and
// adapt", P1 "Native push").
//
// Registration is a mutation, so it goes through the same dual-auth guard as
// every other v1 mutation: requireActor proves the bearer token, then
// assertMutationAllowed applies the JSON content-type rule for native callers
// (there is no browser Origin to check). Nothing here trusts a user id from
// the body — the device is always filed under the authenticated actor.
import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  ForbiddenOriginError,
  UnsupportedContentTypeError,
  assertMutationAllowed,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError, type RequestActor } from "@/lib/auth/requestActor";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isValidInstallationId,
  parseDeviceRegistration,
  registerDevice,
  revokeDevice,
  type DeviceRegistrationProblem,
} from "@/lib/push/devices";
import { nativePushConfigured } from "@/lib/push/expo";

export const dynamic = "force-dynamic";

const PROBLEM_MESSAGES: Record<DeviceRegistrationProblem, string> = {
  invalid_installation_id: "installationId must be a UUID",
  invalid_platform: "platform must be 'ios' or 'android'",
  invalid_push_token: "expoPushToken must be an Expo push token",
  invalid_metadata: "Device metadata values must be strings of at most 64 characters",
};

async function guard(request: Request): Promise<RequestActor | Response> {
  let actor: RequestActor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  return actor;
}

function isResponse(value: RequestActor | Response): value is Response {
  return value instanceof Response;
}

export async function POST(request: Request) {
  const actor = await guard(request);
  if (isResponse(actor)) return actor;

  // Refusing up front is what keeps a deployment without native push from
  // collecting tokens it will never send to. The app gates on the same
  // switch via bootstrap's capabilities.nativePush, so this is a backstop
  // for a stale build rather than the normal path.
  if (!nativePushConfigured()) {
    return apiError(request, "NATIVE_PUSH_UNAVAILABLE", "Native push is not enabled for this deployment", 503, {
      retryable: true,
    });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseDeviceRegistration(body);
  if (!parsed.ok) {
    return apiError(request, parsed.problem.toUpperCase(), PROBLEM_MESSAGES[parsed.problem], 400);
  }

  const result = await registerDevice(createAdminClient(), actor.userId, parsed.input);
  if (!result.ok) {
    console.error("[devices] registration failed:", result.error);
    return apiError(request, "DEVICE_REGISTRATION_FAILED", "Could not register this device", 500, {
      retryable: true,
    });
  }

  const response = apiSuccess(request, { registered: true, deviceId: result.deviceId });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function DELETE(request: Request) {
  const actor = await guard(request);
  if (isResponse(actor)) return actor;

  // Accepts the installation id in the body or the query string: the native
  // client sends a JSON body, and a query parameter keeps the route usable
  // from a plain curl during support work.
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const fromQuery = new URL(request.url).searchParams.get("installation_id");
  const installationId = isValidInstallationId(body?.installationId)
    ? String(body?.installationId).trim()
    : isValidInstallationId(fromQuery)
      ? String(fromQuery).trim()
      : null;

  if (!installationId) {
    return apiError(request, "INVALID_INSTALLATION_ID", "installationId must be a UUID", 400);
  }

  const result = await revokeDevice(createAdminClient(), actor.userId, installationId);
  if (!result.ok) {
    console.error("[devices] revocation failed:", result.error);
    return apiError(request, "DEVICE_REVOCATION_FAILED", "Could not unregister this device", 500, {
      retryable: true,
    });
  }

  // Idempotent by design: unregistering an installation that was already
  // revoked (or never registered) is a success, so a retry after a dropped
  // response does not surface as an error to the member.
  const response = apiSuccess(request, { registered: false, revoked: result.revoked });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
