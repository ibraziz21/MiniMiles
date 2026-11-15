// GET/PUT /api/v1/me/discovery-contributions/:id — id = contribution request.
//
// The native counterpart of /api/me/discovery-contributions/:id, so the app
// can recommend a place in its own screens instead of sending the member to
// a website they aren't signed in to. Same answer rules and RPC as the web
// route (lib/discovery/contributions.ts); bearer or cookie auth via
// requireActor, mutation guard and rate limit as for every v1 write.
import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { checkAllRateLimits } from "@/lib/rateLimit";
import {
  CONTRIBUTION_UUID_RE,
  loadMemberContributionRequest,
  parseContributionAnswers,
  submitDiscoveryContribution,
} from "@/lib/discovery/contributions";

export const dynamic = "force-dynamic";

const SUBMIT_ERRORS: Record<string, { code: string; message: string }> = {
  not_found: { code: "CONTRIBUTION_NOT_FOUND", message: "This visit couldn’t be found." },
  expired: { code: "CONTRIBUTION_EXPIRED", message: "This visit can no longer be added." },
  invalid_state: { code: "CONTRIBUTION_CLOSED", message: "This visit can no longer be changed." },
};

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!CONTRIBUTION_UUID_RE.test(params.id)) return apiError(request, "INVALID_ID", "Invalid visit", 400);

  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    throw error;
  }

  let contributionRequest;
  try {
    contributionRequest = await loadMemberContributionRequest(actor.userId, params.id);
  } catch (error) {
    console.error("[api/v1/me/discovery-contributions/:id]", error);
    return apiError(request, "CONTRIBUTION_UNAVAILABLE", "Couldn’t load this visit", 503, { retryable: true });
  }
  if (!contributionRequest) return apiError(request, "CONTRIBUTION_NOT_FOUND", "This visit couldn’t be found.", 404);

  const response = apiSuccess(request, { request: contributionRequest });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  if (!CONTRIBUTION_UUID_RE.test(params.id)) return apiError(request, "INVALID_ID", "Invalid visit", 400);

  let actor;
  try {
    actor = await requireActor(request);
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const withinLimits = await checkAllRateLimits([
    { scope: `discovery_contribution_submit:user:${actor.userId}`, limit: 20, windowSeconds: 600 },
  ]);
  if (!withinLimits) return apiError(request, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.", 429);

  const parsed = parseContributionAnswers(await request.json().catch(() => null));
  if (!parsed.ok) return apiError(request, "INVALID_ANSWERS", parsed.error, 400);

  const outcome = await submitDiscoveryContribution(actor.userId, params.id, parsed.answers);
  if (!outcome.ok) {
    const known = SUBMIT_ERRORS[outcome.error];
    if (known) return apiError(request, known.code, known.message, outcome.status);
    if (outcome.status === 422) return apiError(request, "INVALID_ANSWERS", outcome.error, 422);
    return apiError(request, "CONTRIBUTION_SAVE_FAILED", "Couldn’t save your visit", 503, { retryable: true });
  }

  return apiSuccess(request, { contributionId: outcome.contributionId });
}
