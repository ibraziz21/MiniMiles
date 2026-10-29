// GET /api/v1/me/vouchers?status=&cursor= — the member's owned vouchers,
// self_or_verified_wallet authorization (hub-mobile-app-migration-plan.md
// "Owned vouchers"). Stable summaries, never the raw issued_vouchers join
// shape — see listOwnedVouchers for the DTO and cursor design.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { multiMerchantFundedOffersV1Flag } from "@/lib/featureFlags.server";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import {
  listOwnedVouchers,
  InvalidOwnedVoucherCursorError,
  OwnedVouchersUnavailableError,
  type OwnedVoucherStatusFilter,
} from "@/lib/vouchers/ownedVouchers.server";

const STATUS_VALUES: OwnedVoucherStatusFilter[] = ["active", "redeemed", "expired"];

/**
 * Statuses where a member could still try to present the voucher, and so
 * could be misdirected by a one-merchant rendering. Mirrors
 * EXPIRABLE_STATUSES in ownedVoucherStatus.ts — anything else is history.
 */
const ACTIONABLE_STATUSES = new Set(["issued", "pending", "claiming"]);

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

    // An old build shows one merchant per voucher, so a multi-merchant one
    // claimed on web would read as usable at only its primary — and send the
    // member to the wrong stall. Withheld while the flag is off; the voucher
    // is not revoked and stays reachable on the web.
    //
    // Only STILL-USABLE vouchers are withheld. This endpoint also serves
    // redeemed and expired ones, and filtering those would delete the
    // member's own history from their app — a worse outcome than an
    // imprecise merchant name on a voucher that is already spent and cannot
    // send anyone anywhere.
    const vouchers = multiMerchantFundedOffersV1Flag().enabled
      ? result.vouchers
      : result.vouchers.filter(
          (voucher) => voucher.participantCount <= 1 || !ACTIONABLE_STATUSES.has(voucher.status),
        );

    const response = apiSuccess(request, { ...result, vouchers });
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
