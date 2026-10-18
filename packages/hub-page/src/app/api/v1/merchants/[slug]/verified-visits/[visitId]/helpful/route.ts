import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import {
  isEligiblePublicVerifiedVisit,
  markVerifiedVisitHelpful,
  unmarkVerifiedVisitHelpful,
} from "@/lib/merchants/verifiedVisitHelpful";

async function handle(
  request: Request,
  params: { slug: string; visitId: string },
  helpful: boolean,
) {
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

  let merchant;
  try {
    merchant = await getPublicMerchant(params.slug, actor.userId);
  } catch (error) {
    if (error instanceof DirectoryUnavailableError) {
      return apiError(request, "DIRECTORY_UNAVAILABLE", "This merchant profile is temporarily unavailable", 503, {
        retryable: true,
      });
    }
    throw error;
  }

  if (!merchant) {
    return apiError(request, "MERCHANT_NOT_FOUND", "Merchant not found", 404);
  }

  if (!await isEligiblePublicVerifiedVisit(params.visitId, merchant.id)) {
    return apiError(request, "VERIFIED_VISIT_NOT_FOUND", "Verified visit not found", 404);
  }

  if (helpful) {
    await markVerifiedVisitHelpful(actor.userId, params.visitId);
  } else {
    await unmarkVerifiedVisitHelpful(actor.userId, params.visitId);
  }

  const response = apiSuccess(request, { helpful });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: { slug: string; visitId: string } },
) {
  return handle(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: { slug: string; visitId: string } },
) {
  return handle(request, params, false);
}
