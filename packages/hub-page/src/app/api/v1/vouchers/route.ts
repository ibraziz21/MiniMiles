import { FundedDiscoveryUnavailable } from "@/lib/vouchers/fundedDiscovery";
// GET /api/v1/vouchers — the public, CDN-cacheable half of the voucher
// catalogue (hub-mobile-app-migration-plan.md "Voucher catalogue
// `/vouchers`"). Always computed with no actor identity — same "anonymous
// baseline" principle used for /api/v1/merchants — so the response never
// varies by caller. Loyalty offers are deliberately not included here: they
// have no public/anonymous rendering anywhere in this system (see
// GET /api/v1/me/voucher-state). Balance and claimed-state live in that
// self-only overlay; the client composes affordability itself.
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getAllTemplates, getFundedOffers } from "@/lib/vouchers/catalogue.server";
import { fundedOffersForV1 } from "@/lib/vouchers/fundedOfferMapping";

// This handler reads nothing request-specific — no headers, cookies, or query
// — so Next treats it as statically prerenderable and executes it during
// `next build`. That ran getServerEnv() at build time and failed the
// production build on secret validation, which is not what "public and
// CDN-cacheable" was meant to mean: the intent is the s-maxage header below,
// served per request and cached at the edge, not a build-time snapshot of the
// voucher catalogue that would go stale the moment a template changed.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
  const [templates, allFundedOffers] = await Promise.all([getAllTemplates(null), getFundedOffers()]);
  // Percentage offers are withheld from this contract until the app release
  // that can parse them is live — see fundedOffersForV1.
  const fundedOffers = fundedOffersForV1(allFundedOffers);

  const response = apiSuccess(request, { templates, fundedOffers });
  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
  } catch (error) {
    if (error instanceof FundedDiscoveryUnavailable) {
      const response = apiError(request, "SERVICE_UNAVAILABLE", "Free offers are temporarily unavailable", 503, { retryable: true });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    throw error;
  }
}
