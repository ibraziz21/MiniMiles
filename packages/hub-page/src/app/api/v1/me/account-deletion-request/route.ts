// POST /api/v1/me/account-deletion-request — AKIBA-MOB-002 §7.3.
//
// The destructive submission. Two things make it safe to retry, which
// matters more here than anywhere else in the API because a member who taps
// twice, or whose response is dropped on a Kenyan mobile network, must not
// end up with two requests or with no receipt:
//
//   - authentication uses requireActorAllowingDeletionPending, so an actor
//     whose own request already exists can still reach this route; and
//   - an existing request is returned verbatim — original id, original
//     requestedAt, original target date — with alreadyRequested: true.
//
// Returns 202 for both the new and the existing case: the request is
// accepted for asynchronous processing, never completed inline.
import {
  requireActorAllowingDeletionPending,
  UnauthorizedError,
} from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import {
  AccountDeletionError,
  resolveRequestSource,
  submitDeletionRequest,
} from "@/lib/akiba/accountDeletion";
import { mapDeletionError } from "@/lib/akiba/accountDeletionErrors";

type Body = {
  challengeId?: unknown;
  otp?: unknown;
  acknowledgement?: unknown;
  policyVersion?: unknown;
};

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireActorAllowingDeletionPending(request);
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

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return apiError(request, "invalid_body", "A JSON body is required", 400);

  const { challengeId, otp, acknowledgement, policyVersion } = body;
  if (
    typeof challengeId !== "string" ||
    typeof otp !== "string" ||
    typeof policyVersion !== "string" ||
    acknowledgement !== true
  ) {
    // Shape validation before anything else, so a malformed client can't
    // burn the member's verification attempt.
    return apiError(
      request,
      "invalid_body",
      "challengeId, otp, policyVersion and acknowledgement are required",
      400,
    );
  }

  try {
    const receipt = await submitDeletionRequest({
      actor,
      challengeId,
      otp,
      acknowledgement: true,
      policyVersion,
      source: resolveRequestSource(request),
    });

    const response = apiSuccess(request, receipt, { status: 202 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      const mapped = mapDeletionError(error.code);
      return apiError(request, mapped.code, mapped.message, mapped.status, {
        retryable: mapped.retryable,
      });
    }
    throw error;
  }
}
