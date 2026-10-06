// GET /api/v1/vouchers — the public, CDN-cacheable half of the voucher
// catalogue (hub-mobile-app-migration-plan.md "Voucher catalogue
// `/vouchers`"). Always computed with no actor identity — same "anonymous
// baseline" principle used for /api/v1/merchants — so the response never
// varies by caller. Loyalty offers are deliberately not included here: they
// have no public/anonymous rendering anywhere in this system (see
// GET /api/v1/me/voucher-state). Balance and claimed-state live in that
// self-only overlay; the client composes affordability itself.
import { apiSuccess } from "@/lib/api/v1/response";
import { getAllTemplates, getFundedOffers } from "@/lib/vouchers/catalogue.server";

export async function GET(request: Request) {
  const [templates, fundedOffers] = await Promise.all([getAllTemplates(null), getFundedOffers()]);

  const response = apiSuccess(request, { templates, fundedOffers });
  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
}
