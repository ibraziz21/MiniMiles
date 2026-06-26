/**
 * Voucher detail (server component).
 * Fetches the voucher with its template + partner, verifies ownership against
 * the signed-in Hub user (hub_user_id OR any linked wallet address), then hands
 * the data to the client VoucherDetailView for display + QR presentation.
 */
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
    .eq("user_id", user.id);
  const addresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());

  const { data: voucher } = await admin
    .from("issued_vouchers")
    .select(`
      id, code, status, created_at, expires_at, redeemed_at,
      acquisition_source, sponsor, hub_user_id, user_address, rules_snapshot,
      spend_voucher_templates (
        id, title, voucher_type, discount_percent, discount_cusd,
        applicable_category, retail_value_cusd, miles_cost,
        partners ( id, slug, name, image_url )
      ),
      voucher_programs ( name )
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
        applicable_category: string | null;
        retail_value_cusd: number | null;
        partners: unknown;
      }
    | null;
  const partner = firstOrNull(tpl?.partners) as
    | { slug: string; name: string; image_url: string | null }
    | null;
  const program = firstOrNull(voucher.voucher_programs) as { name: string } | null;
  const snapshot =
    voucher.rules_snapshot && typeof voucher.rules_snapshot === "object" && !Array.isArray(voucher.rules_snapshot)
      ? voucher.rules_snapshot as Record<string, unknown>
      : null;

  const snapshotType =
    snapshot?.voucher_type === "percent" ? "percent_off" :
    snapshot?.voucher_type === "fixed" ? "fixed_off" :
    snapshot?.voucher_type === "free_product" ? "free" :
    snapshot?.voucher_type;

  const snapshotHas = (key: string) =>
    snapshot !== null && Object.prototype.hasOwnProperty.call(snapshot, key);

  const snapshotNumber = (key: string, fallback: number | null): number | null => {
    if (!snapshotHas(key)) return fallback;
    const value = snapshot?.[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return null;
  };

  const detail: DetailVoucher = {
    id: voucher.id,
    code: voucher.code,
    status: voucher.status as DetailVoucher["status"],
    created_at: voucher.created_at,
    expires_at: voucher.expires_at,
    redeemed_at: voucher.redeemed_at,
    acquisition_source: voucher.acquisition_source ?? null,
    sponsor: voucher.sponsor ?? null,
    program_name: program?.name ?? null,
    template: tpl
      ? {
          title: typeof snapshot?.title === "string" ? snapshot.title : tpl.title,
          voucher_type:
            typeof snapshotType === "string"
              ? snapshotType as VoucherType
              : tpl.voucher_type,
          discount_percent: snapshotNumber("discount_percent", tpl.discount_percent),
          discount_cusd: snapshotNumber("discount_cusd", tpl.discount_cusd),
          applicable_category:
            snapshotHas("applicable_category")
              ? typeof snapshot?.applicable_category === "string"
                ? snapshot.applicable_category
                : null
              : tpl.applicable_category,
          retail_value_cusd: snapshotNumber("retail_value_cusd", tpl.retail_value_cusd),
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
