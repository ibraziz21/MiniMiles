import { apiSuccess } from "@/lib/api/v1/response";
import { listPublicMerchantOffers } from "@/lib/merchants/publicOffers";

export async function GET(request: Request) {
  const offers = await listPublicMerchantOffers(50);
  const response = apiSuccess(request, { offers });
  response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  return response;
}
