// POST/DELETE /api/v1/merchants/:slug/save — hub-mobile-app-migration-plan.md
// mutation table. First production route to exercise the auth-mode-aware
// mutation guard (requestActor.ts/mutationGuard.ts, built in the Phase 1
// round, unit-tested since but never called by a real route until now).
// Mirrors src/app/api/merchants/[slug]/save/route.ts's resolveMerchantId
// tri-state and saveMerchant/unsaveMerchant calls exactly — same
// business logic, dual-auth instead of cookie-only. GET is not ported:
// GET /api/v1/me/merchant-state/:slug already returns `saved`.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { saveMerchant, unsaveMerchant } from "@/lib/merchants/savedMerchants";

async function resolveMerchantId(slug: string, userId: string): Promise<string | null | "unavailable"> {
  try {
    const merchant = await getPublicMerchant(slug, userId);
    return merchant?.id ?? null;
  } catch (err) {
    if (err instanceof DirectoryUnavailableError) return "unavailable";
    throw err;
  }
}

async function handle(
  request: Request,
  params: { slug: string },
  action: (userId: string, merchantId: string) => Promise<void>,
  saved: boolean,
) {
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

  const merchantId = await resolveMerchantId(params.slug, actor.userId);
  if (merchantId === "unavailable") {
    return apiError(request, "DIRECTORY_UNAVAILABLE", "This merchant profile is temporarily unavailable", 503, {
      retryable: true,
    });
  }
  if (!merchantId) {
    return apiError(request, "MERCHANT_NOT_FOUND", "Merchant not found", 404);
  }

  await action(actor.userId, merchantId);

  const response = apiSuccess(request, { saved });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  return handle(request, params, saveMerchant, true);
}

export async function DELETE(request: Request, { params }: { params: { slug: string } }) {
  return handle(request, params, unsaveMerchant, false);
}
