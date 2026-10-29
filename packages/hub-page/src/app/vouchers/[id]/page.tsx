import { entitlementFromIssued } from "@/lib/vouchers/customerEntitlement";
/**
 * Voucher detail (server component).
 * Fetches the voucher with its template + partner, verifies ownership against
 * the signed-in Hub user (hub_user_id OR any linked wallet address), then hands
 * the data to the client VoucherDetailView for display + QR presentation.
 */
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSnapshotParticipants } from "@/lib/vouchers/fundedOfferMerchants.server";
import { snapshotParticipantIds, applyImmutableRulesSnapshot } from "@/lib/vouchers/rulesSnapshot";
import { VoucherDetailView, type DetailVoucher, type VoucherType } from "./VoucherDetailView";

export const dynamic = "force-dynamic";

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function VoucherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id)
    .eq("verification_status", "verified");
  const addresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());

  const { data: voucher } = await admin
    .from("issued_vouchers")
    .select(`
      id, code, status, created_at, expires_at, redeemed_at,
      acquisition_source, sponsor, hub_user_id, user_address, rules_snapshot,
      spend_voucher_templates (
        id, title, voucher_type, discount_percent, discount_cusd, discount_kes,
        applicable_category, linked_product_id, maximum_discount_kes, minimum_spend_kes, terms_text, retail_value_cusd, retail_value_kes, miles_cost,
        partners ( id, slug, name, image_url )
      ),
      voucher_programs ( name ),
      voucher_redemptions ( merchant_id )
    `)
    .eq("id", id)
    .maybeSingle();

  if (!voucher) notFound();

  const owns =
    voucher.hub_user_id === user.id ||
    (typeof voucher.user_address === "string" &&
      addresses.includes(voucher.user_address.toLowerCase()));
  if (!owns) notFound();

  const tpl = firstOrNull(voucher.spend_voucher_templates) as
    | {
        title: string;
        voucher_type: VoucherType;
        discount_percent: number | null;
        discount_cusd: number | null;
        discount_kes: number | null;
        applicable_category: string | null;
        maximum_discount_kes: number | null;
        minimum_spend_kes: number | null;
        terms_text: string | null;
        linked_product_id: string | null;
        retail_value_cusd: number | null;
        retail_value_kes?: number | null;
        partners: unknown;
      }
    | null;
  const primaryPartner = firstOrNull(tpl?.partners) as
    | { id: string; slug: string; name: string; image_url: string | null }
    | null;
  const program = firstOrNull(voucher.voucher_programs) as { name: string } | null;
  const merged = tpl ? applyImmutableRulesSnapshot(tpl, voucher.rules_snapshot) : null;

  // Participants come from this voucher's own snapshot, never the
  // allocation's current set (BDR-006 §4.2). The count is the snapshot's even
  // when a profile cannot be resolved, so an archived partner cannot shrink
  // the entitlement on screen.
  const participantIds = snapshotParticipantIds(voucher.rules_snapshot);
  const redemption = firstOrNull(voucher.voucher_redemptions) as { merchant_id: string | null } | null;
  const redeemerId = voucher.status === "redeemed" ? redemption?.merchant_id : null;
  const resolved = await resolveSnapshotParticipants([...new Set([
    ...participantIds, ...(redeemerId ? [redeemerId] : []),
  ])]);
  const participants = {
    merchants: resolved.merchants.filter((merchant) => participantIds.includes(merchant.id)),
    count: participantIds.length,
    incomplete: participantIds.some((id) => !resolved.merchants.some((merchant) => merchant.id === id)),
  };
  const redeemer = resolved.merchants.find((merchant) => merchant.id === redeemerId);
  const partner = voucher.status === "redeemed"
    ? redeemer ? { name: redeemer.name, slug: redeemer.slug, image_url: redeemer.imageUrl } : null
    : primaryPartner;

  const entitlement = entitlementFromIssued({ template: tpl, snapshot: voucher.rules_snapshot,
    expiresAt: voucher.expires_at, merchants: participants.merchants,
    primaryMerchant: primaryPartner ? { ...primaryPartner, imageUrl: primaryPartner.image_url } : null,
  });
  const detail: DetailVoucher = {
    entitlement,
    id: voucher.id,
    participantMerchants: participants.merchants,
    participantCount: participants.count,
    participantsIncomplete: participants.incomplete,
    redemptionSchedule: voucher.rules_snapshot?.redemption_schedule ?? null,
    code: voucher.code,
    status: voucher.status as DetailVoucher["status"],
    created_at: voucher.created_at,
    expires_at: voucher.expires_at,
    redeemed_at: voucher.redeemed_at,
    acquisition_source: voucher.acquisition_source ?? null,
    sponsor: voucher.sponsor ?? null,
    program_name: program?.name ?? null,
    template: merged
      ? {
          title: merged.title,
          voucher_type: merged.voucherType,
          discount_percent: merged.discountPercent,
          discount_cusd: merged.discountCusd,
          discount_kes: merged.discountKes,
          applicable_category: merged.applicableCategory,
          retail_value_cusd: merged.retailValueCusd,
          partner: partner
            ? { slug: partner.slug, name: partner.name, image_url: partner.image_url }
            : null,
        }
      : null,
  };

  return (
    <main className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <VoucherDetailView voucher={detail} />
    </main>
  );
}
