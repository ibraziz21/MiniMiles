// POST /api/v1/me/account-deletion/challenge — AKIBA-MOB-002 §7.2.
//
// Issues the email-ownership challenge for a deletion request. Three rules
// the implementation turns into code rather than documentation:
//
//   - the address comes from the authenticated actor, never the body, so
//     this route can't be used to send mail to an arbitrary address;
//   - the Supabase OTP is requested with shouldCreateUser: false, so a
//     deletion flow can never bring an account into existence; and
//   - the response says the same thing whatever happened upstream, so it
//     isn't an email-enumeration oracle.
import {
  requireActor,
  UnauthorizedError,
} from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { AccountDeletionError, createDeletionChallenge } from "@/lib/akiba/accountDeletion";
import { mapDeletionError } from "@/lib/akiba/accountDeletionErrors";

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

  try {
    const challenge = await createDeletionChallenge(actor);
    const response = apiSuccess(request, challenge);
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
