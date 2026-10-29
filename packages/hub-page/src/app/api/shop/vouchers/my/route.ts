import { entitlementFromIssued } from "@/lib/vouchers/customerEntitlement";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSnapshotParticipants } from "@/lib/vouchers/fundedOfferMerchants.server";
import { applyImmutableRulesSnapshot, snapshotParticipantIds } from "@/lib/vouchers/rulesSnapshot";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Resolve all wallet addresses linked to this Hub user
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id)
    .eq("verification_status", "verified");

  const addresses = (walletRows ?? []).map((r) => r.address.toLowerCase());

  // Query vouchers owned by this Hub user:
  //   • new rows: hub_user_id = user.id
  //   • legacy rows: user_address IN (linked wallet addresses)
  let query = admin
    .from("issued_vouchers")
    .select(`
      id, code, status, created_at, expires_at, redeemed_at,
      acquisition_source, sponsor,
      rules_snapshot,
      spend_voucher_templates (
        id, title, voucher_type, discount_percent, discount_cusd, discount_kes,
        applicable_category, linked_product_id, maximum_discount_kes, minimum_spend_kes, terms_text, retail_value_cusd, retail_value_kes, miles_cost,
        partners ( id, slug, name, image_url )
      ),
      voucher_programs ( name ),
      voucher_redemptions ( merchant_id )
    `)
    .neq("status", "void")
    .order("created_at", { ascending: false });

  if (addresses.length > 0) {
    query = query.or(
      `hub_user_id.eq.${user.id},user_address.in.(${addresses.join(",")})`
    );
  } else {
    query = query.eq("hub_user_id", user.id);
  }

  const { data: vouchers, error } = await query;

  if (error) {
    console.error("[my-vouchers]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = vouchers ?? [];
  const ids = [...new Set(rows.flatMap((row) => {
    const redemption = one(row.voucher_redemptions);
    return [
      ...snapshotParticipantIds(row.rules_snapshot),
      ...(row.status === "redeemed" && redemption?.merchant_id ? [redemption.merchant_id] : []),
    ];
  }))];
  const resolved = await resolveSnapshotParticipants(ids);
  const byId = new Map(resolved.merchants.map((merchant) => [merchant.id, merchant]));

  return NextResponse.json({ vouchers: rows.map((row) => {
    const template = one(row.spend_voucher_templates);
    const merged = template ? applyImmutableRulesSnapshot(template, row.rules_snapshot) : null;
    const redemption = one(row.voucher_redemptions);
    const redeemer = redemption?.merchant_id ? byId.get(redemption.merchant_id) : null;
    const participantIds = snapshotParticipantIds(row.rules_snapshot);
    // The template's primary is not evidence of where a spent voucher was used.
    const merchant = row.status === "redeemed"
      ? redeemer ? { id: redeemer.id, name: redeemer.name, slug: redeemer.slug, image_url: redeemer.imageUrl } : null
      : template?.partners ?? null;
    const { voucher_redemptions: _redemptions, rules_snapshot: _snapshot, ...voucher } = row;
    const primary = one(template?.partners);
    return {
      ...voucher,
      entitlement: entitlementFromIssued({ template, snapshot: row.rules_snapshot, expiresAt: row.expires_at,
        merchants: resolved.merchants,
        primaryMerchant: primary ? { ...primary, imageUrl: primary.image_url } : null,
      }),
      participantCount: participantIds.length,
      participantMerchants: participantIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
      participantsIncomplete: participantIds.some((id) => !byId.has(id)),
      spend_voucher_templates: template && merged ? {
        ...template, partners: merchant, title: merged.title,
        voucher_type: merged.voucherType, discount_percent: merged.discountPercent,
        discount_cusd: merged.discountCusd, discount_kes: merged.discountKes,
        applicable_category: merged.applicableCategory, retail_value_cusd: merged.retailValueCusd,
      } : null,
    };
  }) });
}
