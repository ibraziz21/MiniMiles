// GET /api/v1/me/vouchers/:id — voucher detail, self_or_verified_wallet
// authorization (hub-mobile-app-migration-plan.md "Voucher detail
// `/vouchers/[id]`"). 404 for both missing and not-owned — non-enumerating,
// matching the existing status route's behavior (the presentation route's
// 403-on-NOT_OWNER is a known inconsistency in today's code, not repeated
// here). Never returns hub_user_id, user_address, the raw rules_snapshot
// blob, code, sponsor, or acquisition_source.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { userOwnsVoucher } from "@/lib/vouchers/issuance";
import { applyImmutableRulesSnapshot, type RulesSnapshotInputTemplate } from "@/lib/vouchers/rulesSnapshot";
import { resolveOwnedVoucherStatus } from "@/lib/vouchers/ownedVoucherStatus";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const walletAddresses = await getLinkedWalletAddresses(actor.userId);
  const owns = await userOwnsVoucher(params.id, actor.userId, walletAddresses);
  if (!owns) {
    return apiError(request, "VOUCHER_NOT_FOUND", "Voucher not found", 404);
  }

  const admin = createAdminClient();
  const { data: voucher } = await admin
    .from("issued_vouchers")
    .select(`
      id, status, created_at, expires_at, redeemed_at, rules_snapshot,
      spend_voucher_templates (
        title, voucher_type, discount_percent, discount_cusd, discount_kes,
        applicable_category, retail_value_cusd, miles_cost,
        partners ( slug, name, image_url )
      ),
      voucher_programs ( name )
    `)
    .eq("id", params.id)
    .maybeSingle();

  if (!voucher) {
    return apiError(request, "VOUCHER_NOT_FOUND", "Voucher not found", 404);
  }

  const tpl = one(voucher.spend_voucher_templates) as
    | (RulesSnapshotInputTemplate & { miles_cost: number; partners: unknown })
    | null;
  const partner = one(tpl?.partners) as { slug: string; name: string; image_url: string | null } | null;
  const program = one(voucher.voucher_programs) as { name: string } | null;
  const merged = tpl ? applyImmutableRulesSnapshot(tpl, voucher.rules_snapshot) : null;

  const response = apiSuccess(request, {
    id: voucher.id,
    status: resolveOwnedVoucherStatus(voucher.status, voucher.expires_at),
    title: merged?.title ?? null,
    voucherType: merged?.voucherType ?? null,
    discountPercent: merged?.discountPercent ?? null,
    discountCusd: merged?.discountCusd ?? null,
    applicableCategory: merged?.applicableCategory ?? null,
    retailValueCusd: merged?.retailValueCusd ?? null,
    milesCost: tpl?.miles_cost ?? null,
    merchantName: partner?.name ?? null,
    merchantSlug: partner?.slug ?? null,
    merchantLogoUrl: partner?.image_url ?? null,
    programName: program?.name ?? null,
    createdAt: voucher.created_at,
    expiresAt: voucher.expires_at,
    redeemedAt: voucher.redeemed_at,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
