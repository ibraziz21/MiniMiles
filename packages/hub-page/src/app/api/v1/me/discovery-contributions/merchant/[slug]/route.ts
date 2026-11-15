// GET /api/v1/me/discovery-contributions/merchant/:slug
//
// "Can this member recommend this place, and which visit is it?" — the
// native counterpart of the web /visit/merchant/:slug entry page. Uses the
// same resolver, which finds an open request or opens one from a recent
// eligible in-store Miles issuance.
//
//   { status: "ready", requestId }           → open the recommendation form
//   { status: "no_issuance" | "no_identity" | "issuance_not_eligible" }
//                                            → nothing to recommend yet
//   { status: "lookup_failed" }              → try again
import { apiError, apiSuccess } from "@/lib/api/v1/response";
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { resolveMerchantContributionFromMilesIssuance } from "@/lib/akiba/discoveryContributions";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) return apiError(request, "MERCHANT_NOT_FOUND", "Merchant not found", 404);

  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    throw error;
  }

  const { data: merchant, error } = await createAdminClient()
    .from("partners")
    .select("id")
    .eq("slug", params.slug)
    .eq("type", "merchant")
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.error("[api/v1/me/discovery-contributions/merchant] merchant lookup failed:", error.message);
    return apiError(request, "CONTRIBUTION_UNAVAILABLE", "Couldn’t check your visit", 503, { retryable: true });
  }
  if (!merchant) return apiError(request, "MERCHANT_NOT_FOUND", "Merchant not found", 404);

  const resolution = await resolveMerchantContributionFromMilesIssuance({
    hubUserId: actor.userId,
    email: actor.email,
    merchantId: merchant.id,
  });

  const response = apiSuccess(request, {
    status: resolution.status,
    requestId: resolution.requestId,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
