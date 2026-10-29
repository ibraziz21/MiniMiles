import { entitlementFromIssued } from "@/lib/vouchers/customerEntitlement";
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
import { multiMerchantFundedOffersV1Flag } from "@/lib/featureFlags.server";
import { getServerEnv } from "@/lib/env.server";
import { resolveSnapshotParticipants } from "@/lib/vouchers/fundedOfferMerchants.server";
import { snapshotParticipantIds, applyImmutableRulesSnapshot, type RulesSnapshotInputTemplate } from "@/lib/vouchers/rulesSnapshot";
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
        applicable_category, linked_product_id, maximum_discount_kes, minimum_spend_kes, terms_text, retail_value_cusd, retail_value_kes, miles_cost,
        partners ( slug, name, image_url )
      ),
      voucher_redemptions ( merchant_id ),
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
  const primaryPartner = one(tpl?.partners) as { slug: string; name: string; image_url: string | null } | null;
  const program = one(voucher.voucher_programs) as { name: string } | null;
  const merged = tpl ? applyImmutableRulesSnapshot(tpl, voucher.rules_snapshot) : null;

  const participantIds = snapshotParticipantIds(voucher.rules_snapshot);
  const redemption = one(voucher.voucher_redemptions) as { merchant_id: string | null } | null;
  const redemptionMerchantId = voucher.status === "redeemed" ? redemption?.merchant_id : null;
  const resolved = await resolveSnapshotParticipants([...new Set([
    ...participantIds, ...(redemptionMerchantId ? [redemptionMerchantId] : []),
  ])]);
  const participants = {
    merchants: resolved.merchants.filter((merchant) => participantIds.includes(merchant.id)),
    count: participantIds.length,
    incomplete: participantIds.some((id) => !resolved.merchants.some((merchant) => merchant.id === id)),
  };
  const redeemedMerchant = resolved.merchants.find((merchant) => merchant.id === redemptionMerchantId);
  const partner = voucher.status === "redeemed"
    ? redeemedMerchant ? { ...redeemedMerchant, image_url: redeemedMerchant.imageUrl } : null
    : primaryPartner;

  // An old build renders one merchant, so a multi-merchant voucher claimed on
  // web would be presented as usable at only its primary. Withhold the detail
  // from this contract until a release can show the full list; the voucher
  // itself is untouched and remains available on the web.
  if (["issued", "pending", "claiming"].includes(resolveOwnedVoucherStatus(voucher.status, voucher.expires_at)) && participantIds.length > 1 && !multiMerchantFundedOffersV1Flag().enabled) {
    // The URL goes in the message because that is the only field an already
    // released build renders. Telling the member to "use the web" without
    // saying where leaves them with no way to reach their own voucher.
    const { siteUrl } = getServerEnv();
    const webUrl = `${siteUrl.replace(/\/$/, "")}/vouchers/${params.id}`;
    return apiError(
      request,
      "VOUCHER_NOT_SUPPORTED",
      `This voucher can be used at several merchants. Update the app to see them, or open ${webUrl}`,
      409,
    );
  }

  const response = apiSuccess(request, {
    id: voucher.id,
    entitlement: entitlementFromIssued({ template: tpl, snapshot: voucher.rules_snapshot, expiresAt: voucher.expires_at,
      merchants: participants.merchants, primaryMerchant: primaryPartner ? { id: "", ...primaryPartner, imageUrl: primaryPartner.image_url } : null }),
    redemptionSchedule: voucher.rules_snapshot?.redemption_schedule ?? null,
    status: resolveOwnedVoucherStatus(voucher.status, voucher.expires_at),
    title: merged?.title ?? null,
    voucherType: merged?.voucherType ?? null,
    discountPercent: merged?.discountPercent ?? null,
    discountCusd: merged?.discountCusd ?? null,
    applicableCategory: merged?.applicableCategory ?? null,
    retailValueCusd: merged?.retailValueCusd ?? null,
    milesCost: tpl?.miles_cost ?? null,
    // From the snapshot, not the allocation's current set — the voucher was
    // judged against the merchants named when it was claimed.
    participantMerchants: participants.merchants,
    participantCount: participants.count,
    participantsIncomplete: participants.incomplete,
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
