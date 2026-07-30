import { Tag } from "lucide-react";
import type { PublicMerchantLocation, PublicVoucherSummary } from "@/lib/merchants/types";
import { voucherLabel } from "@/lib/pricing";
import { GetVoucherButton } from "@/components/vouchers/GetVoucherButton";

export function VoucherCard({
  voucher: v,
  locations,
  isSignedIn,
}: {
  voucher: PublicVoucherSummary;
  locations: PublicMerchantLocation[];
  isSignedIn: boolean;
}) {
  const branchNames = v.branchIds
    ? locations.filter((l) => v.branchIds!.includes(l.id)).map((l) => l.name)
    : null;

  return (
    <div className="rounded-xl bg-akiba-card p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-akiba-teal/10">
          <Tag className="h-4 w-4 text-akiba-teal" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-akiba-ink">{v.title}</p>
          <p className="text-xs text-akiba-teal">
            {voucherLabel({
              voucher_type: v.voucherType,
              discount_percent: v.discountPercent,
              discount_cusd: v.discountCusd,
              applicable_category: v.applicableCategory,
              linked_product_id: v.linkedProductId,
              retail_value_cusd: v.retailValueCusd,
            })}
          </p>
          <p className="text-[11px] text-akiba-muted">
            {branchNames ? `Available at ${branchNames.join(", ")}` : "Available at all branches"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-akiba-ink">{v.milesCost.toLocaleString()}</p>
          <p className="text-[11px] text-akiba-muted">miles</p>
        </div>
      </div>
      <div className="mt-3">
        <GetVoucherButton templateId={v.id} milesCost={v.milesCost} isSignedIn={isSignedIn} />
      </div>
    </div>
  );
}
