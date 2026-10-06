// GET /api/v1/me/vouchers?status=&cursor= — the member's owned vouchers,
// self_or_verified_wallet authorization (hub-mobile-app-migration-plan.md
// "Owned vouchers"). Stable summaries, never the raw issued_vouchers join
// shape — see listOwnedVouchers for the DTO and cursor design.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import {
  listOwnedVouchers,
  InvalidOwnedVoucherCursorError,
  OwnedVouchersUnavailableError,
  type OwnedVoucherStatusFilter,
} from "@/lib/vouchers/ownedVouchers.server";

const STATUS_VALUES: OwnedVoucherStatusFilter[] = ["active", "redeemed", "expired"];

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
  const statusParam = searchParams.get("status");
  if (statusParam !== null && !STATUS_VALUES.includes(statusParam as OwnedVoucherStatusFilter)) {
    return apiError(request, "INVALID_STATUS", "status must be active, redeemed, or expired", 400);
  }
  const status = (statusParam as OwnedVoucherStatusFilter | null) ?? undefined;

  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  try {
    const walletAddresses = await getLinkedWalletAddresses(actor.userId);
    const result = await listOwnedVouchers({ userId: actor.userId, walletAddresses, status, cursor, limit });

    const response = apiSuccess(request, result);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof InvalidOwnedVoucherCursorError) {
      return apiError(request, "INVALID_CURSOR", "cursor is invalid or stale", 400);
    }
    if (error instanceof OwnedVouchersUnavailableError) {
      return apiError(request, "VOUCHERS_UNAVAILABLE", "Your vouchers are temporarily unavailable", 503, {
        retryable: true,
      });
    }
    throw error;
  }
}
