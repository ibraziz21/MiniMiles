// GET /api/v1/me/voucher-state — self-only overlay for the voucher
// catalogue. Loyalty offers live here in full (not just their
// eligible/alreadyClaimed/progress fields) because they're inherently
// member-specific — list_loyalty_voucher_offers_hub already returns []
// for an anonymous caller, so there's no public projection to compose
// against; the overlay is the only place they can be returned at all.
// claimFriction is included so a native client can gate loyalty-claim's
// use-plan picker without a separate eligibility call — this is the one
// field the legacy loyalty eligibility route carries that the rest of this
// payload doesn't already duplicate.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getSignedInBalance } from "@/lib/merchants/enrich";
import { getClaimedAllocationIds, getLoyaltyOffers } from "@/lib/vouchers/catalogue.server";
import { getVoucherClaimFriction } from "@/lib/vouchers/claimIntent";

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

  const [balance, claimedAllocationIds, loyaltyOffers, claimFriction] = await Promise.all([
    getSignedInBalance(actor.userId, actor.email),
    getClaimedAllocationIds(actor.userId, actor.email),
    getLoyaltyOffers(actor.userId, actor.email),
    getVoucherClaimFriction(actor.userId),
  ]);

  const response = apiSuccess(request, {
    balance,
    claimedFundedAllocationIds: Array.from(claimedAllocationIds),
    loyaltyOffers,
    claimFriction,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
