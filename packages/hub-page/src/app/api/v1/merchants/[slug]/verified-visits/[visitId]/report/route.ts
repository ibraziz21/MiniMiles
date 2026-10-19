// POST /api/v1/merchants/:slug/verified-visits/:visitId/report
//
// In-app reporting for verified-visit content, required by Google Play's
// user-generated content policy. Sibling of the `helpful` route next door
// and intentionally identical in structure: same guards, same merchant and
// eligibility resolution, same error vocabulary.
//
// The eligibility check does double duty. It stops a report being filed
// against a card that is hidden, withdrawn or belongs to another merchant —
// and because it resolves through the same `eligible_public_merchant_visit_cards`
// projection the public surface reads, a member can only report something
// they could actually see.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { isEligiblePublicVerifiedVisit } from "@/lib/merchants/verifiedVisitHelpful";
import {
  isVerifiedVisitReportReason,
  reportVerifiedVisit,
} from "@/lib/merchants/verifiedVisitReports";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: { slug: string; visitId: string } },
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

  const body = (await request.json().catch(() => null)) as
    | { reason?: unknown; photoId?: unknown }
    | null;

  if (!isVerifiedVisitReportReason(body?.reason)) {
    return apiError(request, "INVALID_REASON", "A supported report reason is required", 400);
  }

  // Optional, and validated rather than trusted: an unparseable id is a
  // client bug, and silently dropping it would file a vaguer report than the
  // member intended.
  const photoId = body?.photoId;
  if (photoId !== undefined && photoId !== null && !(typeof photoId === "string" && UUID_RE.test(photoId))) {
    return apiError(request, "INVALID_PHOTO_ID", "photoId must be a UUID when provided", 400);
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

  if (!(await isEligiblePublicVerifiedVisit(params.visitId, merchant.id))) {
    return apiError(request, "VERIFIED_VISIT_NOT_FOUND", "Verified visit not found", 404);
  }

  const result = await reportVerifiedVisit({
    hubUserId: actor.userId,
    contributionId: params.visitId,
    photoId: typeof photoId === "string" ? photoId : null,
    reason: body.reason,
  });

  if (!result.ok) {
    return apiError(request, "REPORT_FAILED", "Could not submit this report. Please try again.", 500, {
      retryable: true,
    });
  }

  // A repeat report is a success. The member's intent is satisfied either
  // way, and answering "you already reported this" invites them to look for
  // another route to complain about the same thing.
  const response = apiSuccess(request, { reported: true, alreadyReported: result.alreadyReported });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
