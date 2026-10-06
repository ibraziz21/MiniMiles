// POST /api/v1/vouchers/loyalty/:templateId/claim — hub-mobile-app-migration-plan.md
// mutation table. Proxies to Akiba-Platform's POST /api/v1/voucher-offers/:id/claim,
// forwarding the actor's own access token (now carried on RequestActor for
// both auth modes — see requestActor.ts). Qualification, inventory, and
// Miles-balance checks all happen server-side on the Platform; this route
// never decides eligibility itself (loyalty-qualified-vouchers-spec.md
// §10, §16). Eligibility is NOT ported here — GET /api/v1/me/voucher-state
// already exposes the same eligible/alreadyClaimed/progress fields.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getServerEnv } from "@/lib/env.server";
import {
  claimIntentIsValid,
  getVoucherClaimFriction,
  isVoucherUsePlan,
  recordVoucherClaimIntent,
} from "@/lib/vouchers/claimIntent";

const DISCLOSURE_VERSION = "loyalty-claim-v1";

export async function POST(request: Request, { params }: { params: { templateId: string } }) {
  const { templateId } = params;

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

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return apiError(request, "SERVICE_UNAVAILABLE", "Service unavailable", 503, { retryable: true });
  }

  const idempotencyKey = `hub-loyalty-claim:${actor.userId}:${templateId}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-offers/${templateId}/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.accessToken}`,
        "Idempotency-Key": idempotencyKey,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[v1 loyalty voucher claim] Platform unreachable:", err);
    return apiError(request, "UPSTREAM_UNREACHABLE", "Could not reach the voucher service. Please try again.", 502, { retryable: true });
  }

  const data = await upstream.json().catch(() => null) as
    | { success?: boolean; data?: { voucherId: string; status: string; expiresAt: string; milesSpent: number; idempotent: boolean }; error?: { code?: string; message?: string } }
    | null;

  if (!upstream.ok || !data?.success || !data.data) {
    return apiError(
      request,
      data?.error?.code ?? "LOYALTY_CLAIM_FAILED",
      data?.error?.message ?? "Could not claim this offer.",
      upstream.status || 502,
    );
  }

  await recordVoucherClaimIntent({
    hubUserId: actor.userId,
    voucherId: data.data.voucherId,
    flow: "loyalty_claim",
    templateId,
    usePlan: isVoucherUsePlan(usePlan) ? usePlan : null,
    friction: claimFriction,
    disclosureVersion: DISCLOSURE_VERSION,
  });

  const response = apiSuccess(request, {
    voucherId: data.data.voucherId,
    status: data.data.status,
    expiresAt: data.data.expiresAt,
    milesSpent: data.data.milesSpent,
    idempotent: data.data.idempotent,
  }, { status: upstream.status });
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
