// POST /api/v1/vouchers/funded/:allocationId/claim — hub-mobile-app-migration-plan.md
// mutation table. Proxies to Akiba-Platform's POST
// /api/v1/voucher-funding-allocations/:id/claim, forwarding the actor's own
// access token. Eligibility is evaluated on the Platform side (same
// evaluator self-claim always uses); this route never decides eligibility
// itself (akiba-funded-founding-merchant-vouchers-spec.md §10.4, §11.1).
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getServerEnv } from "@/lib/env.server";
import { evaluateFundedVoucherCountryEligibility } from "@/lib/akiba/fundedVoucherCountryEligibility";
import {
  claimIntentIsValid,
  getVoucherClaimFriction,
  isVoucherUsePlan,
  recordVoucherClaimIntent,
} from "@/lib/vouchers/claimIntent";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import { getActiveUsernameForHubUser } from "@/lib/akiba/voucherUsername";

const DISCLOSURE_VERSION = "funded-claim-v1";

export async function POST(request: Request, { params }: { params: { allocationId: string } }) {
  // Phase 1 kill switch — see the eligibility route for why this is checked
  // first. Platform independently enforces the same flag on its own claim
  // endpoint so a direct call there cannot bypass this.
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

  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const intentConfirmed = body?.intent_confirmed;
  const usePlan = body?.use_plan;
  const claimFriction = await getVoucherClaimFriction(actor.userId);
  if (!claimIntentIsValid(intentConfirmed, usePlan, claimFriction)) {
    return apiError(
      request,
      "CLAIM_INTENT_REQUIRED",
      claimFriction.requiresUsePlan
        ? "Confirm your intent and choose how you plan to use this voucher"
        : "Confirm that you intend to use this voucher before it expires",
      400,
    );
  }

  // Username requirement (voucher-web2-username-identity-spec.md §3.4) — a
  // new claim must never reach Platform without one. The client-supplied
  // body never carries a username; this reads the authenticated actor's own
  // server-resolved value, so it can never become an ownership credential.
  const username = await getActiveUsernameForHubUser({ hubUserId: actor.userId, email: actor.email });
  if (!username) {
    return apiError(request, "USERNAME_REQUIRED", "Choose an Akiba username to claim this offer.", 422);
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
    const required = countryEligibility.reasonCode === "profile_country_required";
    return apiError(
      request,
      required ? "COUNTRY_PROFILE_REQUIRED" : "COUNTRY_NOT_ELIGIBLE",
      required
        ? "Set your profile country to Kenya to claim this offer."
        : "This offer is available only to members whose profile country is Kenya.",
      422,
    );
  }

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return apiError(request, "SERVICE_UNAVAILABLE", "Service unavailable", 503, { retryable: true });
  }

  const idempotencyKey = `hub-claim:${actor.userId}:${allocationId}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-funding-allocations/${allocationId}/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.accessToken}`,
        "Idempotency-Key": idempotencyKey,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[v1 voucher-funding claim] Platform unreachable:", err);
    return apiError(request, "UPSTREAM_UNREACHABLE", "Could not reach the voucher service. Please try again.", 502, { retryable: true });
  }

  const data = await upstream.json().catch(() => null) as
    | { success?: boolean; data?: { voucherId: string; status: string; expiresAt: string; idempotent: boolean }; error?: { code?: string; message?: string } }
    | null;

  if (!upstream.ok || !data?.success || !data.data) {
    return apiError(
      request,
      data?.error?.code ?? "FUNDED_CLAIM_FAILED",
      data?.error?.message ?? "Could not claim this offer.",
      upstream.status || 502,
    );
  }

  await recordVoucherClaimIntent({
    hubUserId: actor.userId,
    voucherId: data.data.voucherId,
    flow: "funded_claim",
    allocationId,
    usePlan: isVoucherUsePlan(usePlan) ? usePlan : null,
    friction: claimFriction,
    disclosureVersion: DISCLOSURE_VERSION,
  });

  const response = apiSuccess(request, {
    voucherId: data.data.voucherId,
    status: data.data.status,
    expiresAt: data.data.expiresAt,
    idempotent: data.data.idempotent,
  }, { status: upstream.status });
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
