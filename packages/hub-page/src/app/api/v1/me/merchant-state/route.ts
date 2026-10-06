// GET /api/v1/me/merchant-state?ids=a,b,c — self-only overlay for the
// merchant directory list (hub-mobile-app-migration-plan.md: "compose a
// small self-only affordability/saved-state overlay in the client").
// Returns only the caller's own balance and which of the requested
// merchant ids are saved — the client composes true `affordable` values
// itself from this `balance` plus the public /api/v1/merchants response's
// `topOffer.milesCost`.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getSignedInBalance } from "@/lib/merchants/enrich";
import { listSavedMerchantIds } from "@/lib/merchants/savedMerchants";

const MAX_IDS = 50;

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

  const { searchParams } = new URL(request.url);
  const ids = Array.from(
    new Set(
      (searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );

  if (ids.length === 0 || ids.length > MAX_IDS) {
    return apiError(request, "INVALID_IDS", `ids must list between 1 and ${MAX_IDS} merchant ids`, 400);
  }

  const [balance, saved] = await Promise.all([
    getSignedInBalance(actor.userId, actor.email),
    listSavedMerchantIds(actor.userId, ids),
  ]);

  const response = apiSuccess(request, { balance, saved: Array.from(saved) });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
