// GET /api/v1/me/pass — hub-mobile-app-migration-plan.md "Pass `/pass`".
// Matches the richer web /pass page's reads (resolveHubProfile then
// getOrCreatePass with the real wallet address), not the existing thin
// GET /api/me/pass route (which skips resolveHubProfile and hardcodes a
// null wallet) — this is a corrected version, per the plan's own
// "Version existing handler" instruction.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { REFERRAL_COOKIE_NAME } from "@/lib/akiba/referral-token";

export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  if (!actor.email) {
    return apiError(request, "PASS_REQUIRES_EMAIL", "Account has no email — cannot issue pass", 422);
  }

  const { walletAddress, displayName } = await resolveHubProfile({
    userId: actor.userId,
    email: actor.email,
  });
  const { publicPassId } = await getOrCreatePass({
    userId: actor.userId,
    email: actor.email,
    walletAddress,
  });

  if (!publicPassId) {
    return apiError(request, "PASS_UNAVAILABLE", "Could not issue pass", 503, { retryable: true });
  }

  const response = apiSuccess(request, {
    publicPassId,
    qrPayload: `akiba-pass:v1:${publicPassId}`,
    displayName,
    email: actor.email,
  });
  response.headers.set("Cache-Control", "private, no-store");

  // Only a cookie-authenticated (web) caller can hold this referral cookie
  // in the first place — a bearer/native request has no cookies at all.
  if (actor.authMode === "cookie") {
    response.cookies.delete(REFERRAL_COOKIE_NAME);
  }

  return response;
}
