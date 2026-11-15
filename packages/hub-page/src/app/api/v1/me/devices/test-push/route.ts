// POST /api/v1/me/devices/test-push
// Sends a real test notification to the signed-in member's own registered
// devices and reports what happened (src/lib/push/testPush.ts). Backs the
// "Send a test notification" button in the app's Settings.
import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  ForbiddenOriginError,
  UnsupportedContentTypeError,
  assertMutationAllowed,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError, type RequestActor } from "@/lib/auth/requestActor";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTestPush } from "@/lib/push/testPush";

export const dynamic = "force-dynamic";

// Enough to retry after fixing a setting; not enough to use as a spam button.
const TESTS_PER_HOUR = 5;

export async function POST(request: Request) {
  let actor: RequestActor;
  try {
    actor = await requireActor(request);
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenOriginError ||
      error instanceof UnsupportedContentTypeError
    ) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const admin = createAdminClient();
  const { data: withinLimit, error: limitError } = await admin.rpc("check_rate_limit", {
    p_scope: `test-push:user:${actor.userId}`,
    p_limit: TESTS_PER_HOUR,
    p_window_seconds: 3600,
  });
  if (limitError) {
    console.error("[test-push] rate limit check failed:", limitError.message);
  } else if (withinLimit === false) {
    return apiError(request, "RATE_LIMITED", "Too many test notifications. Try again later.", 429, { retryable: true });
  }

  try {
    const result = await sendTestPush(admin, actor.userId);
    return apiSuccess(request, result);
  } catch (error) {
    console.error("[test-push] failed:", error);
    return apiError(request, "TEST_PUSH_FAILED", "Could not send a test notification", 500, { retryable: true });
  }
}
