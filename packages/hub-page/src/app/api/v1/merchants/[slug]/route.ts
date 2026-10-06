// GET /api/v1/merchants/:slug — the public, CDN-cacheable half of the
// merchant detail screen (hub-mobile-app-migration-plan.md "Merchant
// detail `/merchants/[slug]`"). Always resolves with no actor identity
// (`getPublicMerchant(slug, null)`, vouchers ranked with `balance: null`,
// funded offers ranked with an empty claimed set) so the response never
// varies by who's asking. Balance, saved state, claimed offers, and visit
// state live in the self-only overlay, GET /api/v1/me/merchant-state/:slug.
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { getMerchantFundedOffers } from "@/lib/vouchers/merchantFundedOffers.server";
import { rankMerchantVouchers, rankMerchantFundedOffers } from "@/lib/merchants/voucherRanking";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  let merchant;
  try {
    merchant = await getPublicMerchant(params.slug, null);
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

  const { vouchers, ...merchantRest } = merchant;
  const fundedOffers = await getMerchantFundedOffers(merchant.id);

  const response = apiSuccess(request, {
    merchant: merchantRest,
    vouchers: rankMerchantVouchers(vouchers, null),
    fundedOffers: rankMerchantFundedOffers(fundedOffers, new Set()),
  });
  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
}
