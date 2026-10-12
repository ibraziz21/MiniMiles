// POST /api/v1/me/onboarding/complete — hub-mobile-app-migration-plan.md
// mutation table ("Bearer auth and idempotency") and AKIBA-MOB-001 §4.
// Self-only, dual-auth, and idempotent: the first call records the
// completion, every later call returns that same timestamp. The read side
// is deliberately not ported — GET /api/v1/me/bootstrap already carries
// `onboarding.complete`, and the app loads it on every cold start, so a
// separate GET /api/v1/me/onboarding would be a second source of truth for
// one boolean.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { markOnboardingComplete, OnboardingUnavailableError } from "@/lib/akiba/onboarding";

export async function POST(request: Request) {
  let actor;
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

  let completion;
  try {
    completion = await markOnboardingComplete({ userId: actor.userId, email: actor.email });
  } catch (error) {
    if (error instanceof OnboardingUnavailableError) {
      console.error(
        "[api/v1/me/onboarding/complete] could not record completion:",
        error.cause instanceof Error ? error.cause.message : error.cause,
      );
      return apiError(request, "ONBOARDING_SAVE_FAILED", "Could not save your progress", 503, {
        retryable: true,
      });
    }
    throw error;
  }

  const response = apiSuccess(request, {
    complete: true as const,
    completedAt: completion.completedAt,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
