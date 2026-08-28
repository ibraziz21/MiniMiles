import { createAdminClient } from "@/lib/supabase/admin";
import { dealLabel, type VoucherTemplate } from "@/lib/akiba/deals";
import { getUserBalance } from "@/lib/akiba/balance";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import type { PublicMerchantSummary } from "./types";
import type { MatchReason, MerchantValueSummary } from "@/lib/home/types";

/**
 * Signed-in Miles balance for the `affordable` reason — `null` when signed
 * out (never a fabricated zero). Shared so the directory doesn't
 * reimplement home's wallet/balance resolution.
 */
export async function getSignedInBalance(userId: string | null, email: string | null): Promise<number | null> {
  if (!userId) return null;
  const { walletAddress } = await resolveHubProfile({ userId, email });
  const { balance } = await getUserBalance({ walletAddress, email });
  return balance;
}

/**
 * Partner IDs the signed-in user has at least one *verified* completed
 * purchase with (home-redesign-spec.md §15 Phase 3, principle #6 — "verified
 * behavior beats proxy behavior"). Resolved the same way `GET
 * /api/shop/orders` resolves order history: linked wallet addresses →
 * `merchant_transactions.user_address`. `disputed` and every in-flight
 * status are deliberately excluded — only `completed` counts as a real,
 * finished purchase. Never throws — a lookup failure yields an empty set so
 * a DB hiccup here can't take down the `for_you` rail (same isolation rule
 * as every other section).
 */
export async function getPurchaseAffinity(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    const addresses = await getLinkedWalletAddresses(userId);
    if (addresses.length === 0) return new Set();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("merchant_transactions")
      .select("partner_id")
      .in("user_address", addresses)
      .eq("status", "completed");

    if (error) {
      console.error("[merchants/enrich] purchase affinity lookup failed:", error.message);
      return new Set();
    }
    return new Set((data ?? []).map((r: { partner_id: string }) => r.partner_id));
  } catch (err) {
    console.error("[merchants/enrich] purchase affinity lookup threw:", err);
    return new Set();
  }
}

export type TopOffer = { templateId: string; label: string; milesCost: number; expiresAt: string | null };

/**
 * One representative (lowest Miles cost, canonically available) active
 * offer per merchant — reuses the same availability RPC as
 * `getCanonicalVoucherCounts` but keeps enough per-template detail to show
 * a real reason ("10% voucher") instead of just a count. Shared by the home
 * feed and the `/merchants` directory so both surfaces reuse one
 * `MerchantValueCard` truthfully (home-redesign-spec.md §7/§15 Phase 2).
 */
export async function getTopOffers(
  partnerIds: string[],
  hubUserId: string | null
): Promise<Record<string, TopOffer>> {
  if (partnerIds.length === 0) return {};
  const admin = createAdminClient();

  const [{ data: templates, error: templatesErr }, { data: availableRows, error: availabilityErr }] =
    await Promise.all([
      admin
        .from("spend_voucher_templates")
        .select("id, partner_id, title, voucher_type, discount_percent, discount_cusd, miles_cost, expires_at")
        .in("partner_id", partnerIds)
        .eq("active", true)
        .order("miles_cost", { ascending: true }),
      admin.rpc("list_available_voucher_template_ids_hub", { p_hub_user_id: hubUserId }),
    ]);

  if (templatesErr || availabilityErr) {
    console.error(
      "[merchants/enrich] top-offer lookup failed:",
      templatesErr?.message ?? availabilityErr?.message
    );
    return {};
  }

  const availableIds = new Set(
    (availableRows ?? []).map((r: { template_id: string } | string) =>
      typeof r === "string" ? r : r.template_id
    )
  );

  const offers: Record<string, TopOffer> = {};
  for (const t of (templates ?? []) as Array<
    Pick<VoucherTemplate, "id" | "title" | "voucher_type" | "discount_percent" | "discount_cusd"> & {
      partner_id: string;
      miles_cost: number;
      expires_at: string | null;
    }
  >) {
    if (!availableIds.has(t.id)) continue;
    // Already ordered by miles_cost ascending — first hit per partner wins.
    if (offers[t.partner_id]) continue;
    offers[t.partner_id] = {
      templateId: t.id,
      label: dealLabel(t as unknown as VoucherTemplate),
      milesCost: t.miles_cost,
      expiresAt: t.expires_at,
    };
  }
  return offers;
}

/**
 * Maps a directory summary row into the shared `MerchantValueCard` shape.
 * `voucherCount` (the merchant-directory spec's "truthful available-voucher
 * count") and `topOffer` (this spec's "strongest offer") are independent
 * and both carried — a count and a single best-offer badge answer different
 * questions and neither substitutes for the other.
 */
export function toMerchantValueSummary(
  m: PublicMerchantSummary,
  offer: TopOffer | undefined,
  balance: number | null,
  intentLabel: string | null,
  voucherCount?: number,
  hasAffinity?: boolean
): MerchantValueSummary {
  const reasons: MatchReason[] = [];
  if (hasAffinity) reasons.push({ kind: "affinity", label: "You've shopped here before" });
  if (intentLabel) reasons.push({ kind: "intent", label: `Matches ${intentLabel}` });
  if (m.distanceKm != null) reasons.push({ kind: "distance", distanceKm: m.distanceKm });
  if (offer) reasons.push({ kind: "voucher", label: offer.label, templateId: offer.templateId });
  const affordable = offer && balance != null ? balance >= offer.milesCost : null;
  if (offer && affordable) reasons.push({ kind: "affordable", templateId: offer.templateId });

  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    logoUrl: m.logoUrl,
    // list_public_merchants/get_public_merchant (external RPCs, not in this
    // repo) don't return partner_settings.banner_url yet — null, not a
    // fabricated guess, until they're updated to select it too.
    bannerUrl: null,
    primaryCategory: m.primaryCategory,
    matchedOffering: null, // requires per-offering search-hit data not returned by list_public_merchants
    operatingModel: m.operatingModel,
    nearestLocation: m.primaryLocation
      ? {
          id: m.primaryLocation.id,
          locality: m.primaryLocation.locality,
          city: m.primaryLocation.city,
          distanceKm: m.distanceKm,
          // Neither list_public_merchants nor the summary DTO carry opening
          // hours/timezone today — "unknown" is truthful, not a guess.
          openStatus: "unknown",
          closesAt: null,
        }
      : null,
    topOffer: offer
      ? { templateId: offer.templateId, label: offer.label, milesCost: offer.milesCost, affordable, expiresAt: offer.expiresAt }
      : null,
    voucherCount,
    // No Platform earn-eligibility/preview contract exists yet (spec §9) —
    // never fabricate an "Earn Miles here" claim.
    earnSummary: null,
    reasons: reasons.slice(0, 3),
  };
}
