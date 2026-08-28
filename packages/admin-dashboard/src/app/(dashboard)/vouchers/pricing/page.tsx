import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VoucherPricingManager, type VoucherPricingBand } from "@/components/vouchers/VoucherPricingManager";

export const dynamic = "force-dynamic";

export default async function VoucherPricingPage() {
  const session = await requireAdminSession("vouchers.read");
  if (!session) redirect("/login");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("platform_voucher_pricing_versions")
    .select("id,benefit_key,display_name,voucher_type,discount_percent,minimum_miles_price,maximum_miles_price,selected_miles_price,effective_from,effective_to")
    .in("status", ["scheduled", "active"])
    .lte("effective_from", now)
    .or(`effective_to.is.null,effective_to.gt.${now}`)
    .order("minimum_miles_price", { ascending: true });

  const bands = (data ?? []).map((band) => ({
    ...band,
    discount_percent: band.discount_percent == null ? null : Number(band.discount_percent),
    minimum_miles_price: Number(band.minimum_miles_price),
    maximum_miles_price: Number(band.maximum_miles_price),
    selected_miles_price: band.selected_miles_price == null ? null : Number(band.selected_miles_price),
  })) as VoucherPricingBand[];
  const canEdit = session.role === "super_admin" && !session.openAccess;

  return (
    <div>
      <TopBar title="Voucher Pricing" subtitle="Akiba-controlled Miles prices for approved voucher benefits" />
      <div className="space-y-5 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Approved benefit bands</CardTitle>
            <CardDescription>
              Select one exact customer price inside each range. KES checkout values never determine these prices.
              Every update creates an effective pricing version and audit record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              Pricing could not be loaded. Confirm the Akiba voucher migration has been applied.
            </p>}
            {!canEdit && <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Pricing is read-only. An authenticated super admin must approve changes.
            </p>}
            <VoucherPricingManager initialBands={bands} canEdit={canEdit} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
