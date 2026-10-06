// GET /api/v1/me/merchant-state/:slug — self-only overlay for the merchant
// detail screen (hub-mobile-app-migration-plan.md: "keep saved/claimed/
// visit state in the self-only overlay. Never expose another user's claim
// state."). Every call below is scoped to `actor.userId`/`actor.email` —
// the requesting member's own identity, never a different one.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { getSignedInBalance } from "@/lib/merchants/enrich";
import { isMerchantSaved } from "@/lib/merchants/savedMerchants";
import { getMemberVerifiedVisitSummary, hasOpenMerchantContributionRequest } from "@/lib/merchants/memberVisits";
import {
  getMerchantFundedOffers,
  getClaimedMerchantFundedAllocationIds,
} from "@/lib/vouchers/merchantFundedOffers.server";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  let merchantId: string | null;
  try {
    const merchant = await getPublicMerchant(params.slug, actor.userId);
    merchantId = merchant?.id ?? null;
  } catch (error) {
    if (error instanceof DirectoryUnavailableError) {
      return apiError(request, "DIRECTORY_UNAVAILABLE", "This merchant profile is temporarily unavailable", 503, {
        retryable: true,
      });
    }
    throw error;
  }

  if (!merchantId) {
    return apiError(request, "MERCHANT_NOT_FOUND", "Merchant not found", 404);
  }

  const fundedOffers = await getMerchantFundedOffers(merchantId);

  const [balance, claimedFundedAllocationIds, saved, verifiedVisit, openContributionRequest] = await Promise.all([
    getSignedInBalance(actor.userId, actor.email),
    getClaimedMerchantFundedAllocationIds(
      fundedOffers.map((offer) => offer.allocationId),
      actor.userId,
      actor.email,
    ),
    isMerchantSaved(actor.userId, merchantId),
    getMemberVerifiedVisitSummary(actor.userId, merchantId),
    hasOpenMerchantContributionRequest(actor.userId, merchantId),
  ]);

  const response = apiSuccess(request, {
    balance,
    saved,
    claimedFundedAllocationIds: Array.from(claimedFundedAllocationIds),
    verifiedVisit,
    openContributionRequest,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
