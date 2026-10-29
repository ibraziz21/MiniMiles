// GET /api/v1/vouchers/funded/:allocationId/eligibility — hub-mobile-app-migration-plan.md
// mutation table. Proxies to Akiba-Platform's GET
// /api/v1/voucher-funding-allocations/:id/eligibility, forwarding the
// actor's own access token. Lets the offer card show why a member doesn't
// qualify before they try to claim (akiba-funded-voucher-admin-spec.md
// §12.2). requireActor (not optionalActor) — username/country checks need a
// real identity.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getServerEnv } from "@/lib/env.server";
import { evaluateFundedVoucherCountryEligibility } from "@/lib/akiba/fundedVoucherCountryEligibility";
import { getVoucherClaimFriction } from "@/lib/vouchers/claimIntent";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import { v1ClaimSupport } from "@/lib/vouchers/fundedOfferMerchants.server";
import { getActiveUsernameForHubUser } from "@/lib/akiba/voucherUsername";

export async function GET(request: Request, { params }: { params: { allocationId: string } }) {
  // Phase 1 kill switch (akiba-funded-voucher-launch-hardening-spec.md §3) —
  // checked before touching Supabase so a disabled flow never leaks whether
  // the allocation/session is otherwise valid. Platform independently
  // enforces the same flag on its own funded endpoints so bypassing this
  // proxy never bypasses the kill switch.
  if (!akibaFundedVouchersHubFlag().enabled) {
    return apiError(request, "SERVICE_UNAVAILABLE", "This offer is not currently available.", 503, { retryable: true });
  }

  const { allocationId } = params;


  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  // Catalogue filtering is not protection on its own: a client holding this
  // allocation id can post straight here. An unsupported shape is refused
  // before issuance, not merely hidden from discovery. Placed after auth and
  // the mutation guard so an unauthenticated or malformed request still gets
  // its own status rather than a capability error.
  const support = await v1ClaimSupport(allocationId);
  if (!support.supported) {
    console.warn("[funded offer] refused v1 request", {
      allocationId,
      kind: support.kind,
      reason: support.reason,
    });
    // Two different failures, and conflating them misleads the member:
    // "update your app" is only true when the shape is known and this build
    // cannot render it. An unresolved shape is unavailability, and retryable.
    return support.kind === "unsupported_shape"
      ? apiError(
          request,
          "OFFER_NOT_SUPPORTED",
          "This offer is not available in this version of the app. Please update to continue.",
          409,
        )
      : apiError(
          request,
          "SERVICE_UNAVAILABLE",
          "This offer is not currently available.",
          503,
          { retryable: true },
        );
  }

  const claimFriction = await getVoucherClaimFriction(actor.userId);

  // Username requirement (voucher-web2-username-identity-spec.md §3.4) comes
  // before country in the preview, matching the self-claim requirement order
  // — a member fixes identity (username) before the country gate matters.
  const username = await getActiveUsernameForHubUser({ hubUserId: actor.userId, email: actor.email });
  if (!username) {
    const response = apiSuccess(request, {
      eligible: false,
      alreadyClaimed: false,
      requirementsRemaining: ["username_required"],
      allocationAvailable: true,
      claimFriction,
    });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }

  const countryEligibility = await evaluateFundedVoucherCountryEligibility({
    allocationId,
    hubUserId: actor.userId,
    email: actor.email,
  });
  if (!countryEligibility.ok) {
    const status = countryEligibility.reason === "allocation_not_found" ? 404 : 503;
    return apiError(request, "SERVICE_UNAVAILABLE", "This offer is not currently available.", status, {
      retryable: status === 503,
    });
  }
  if (!countryEligibility.eligible) {
    const response = apiSuccess(request, {
      eligible: false,
      alreadyClaimed: false,
      requirementsRemaining: [countryEligibility.reasonCode ?? "profile_country_mismatch"],
      allocationAvailable: true,
      claimFriction,
    });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return apiError(request, "SERVICE_UNAVAILABLE", "Service unavailable", 503, { retryable: true });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-funding-allocations/${allocationId}/eligibility`, {
      headers: { Authorization: `Bearer ${actor.accessToken}`, "Cache-Control": "no-store" },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[v1 voucher-funding eligibility] Platform unreachable:", err);
    return apiError(request, "UPSTREAM_UNREACHABLE", "Could not check eligibility right now.", 502, { retryable: true });
  }

  const data = await upstream.json().catch(() => null) as
    | { success?: boolean; data?: { eligible: boolean; alreadyClaimed: boolean; requirementsRemaining: string[]; allocationAvailable: boolean }; error?: { message?: string } }
    | null;

  if (!upstream.ok || !data?.success) {
    return apiError(request, "FUNDED_ELIGIBILITY_FAILED", data?.error?.message ?? "Could not check eligibility.", upstream.status || 502);
  }

  const response = apiSuccess(request, { ...data.data, claimFriction });
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
