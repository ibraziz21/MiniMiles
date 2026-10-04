import { Tag } from "lucide-react";
import type { PublicMerchantLocation, PublicVoucherSummary } from "@/lib/merchants/types";
import { GetVoucherButton } from "@/components/vouchers/GetVoucherButton";
import { MilesAmount } from "@/components/MilesIcon";
import { dealLabel } from "@/lib/akiba/deals";

export function VoucherCard({
  voucher: v,
  locations,
  isSignedIn,
  balance,
}: {
  voucher: PublicVoucherSummary;
  locations: PublicMerchantLocation[];
  isSignedIn: boolean;
  balance: number | null;
}) {
  const voucherLabel = dealLabel({
    voucher_type: v.voucherType,
    discount_percent: v.discountPercent,
    discount_cusd: v.discountCusd,
    retail_value_cusd: v.retailValueCusd,
  });
  const branchNames = v.branchIds
    ? locations.filter((l) => v.branchIds!.includes(l.id)).map((l) => l.name)
    : null;
  const milesGap = balance == null ? null : Math.max(0, v.milesCost - balance);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-akiba-line bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-akiba-teal">
          <Tag className="h-4 w-4" aria-hidden="true" /> Miles voucher
        </span>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1 text-sm font-semibold text-akiba-ink">
            <MilesAmount amount={v.milesCost} size="sm" />
            <span>Miles</span>
          </div>
          {milesGap === 0 && <p className="mt-1 text-[11px] font-medium text-akiba-teal">Within your balance</p>}
          {milesGap != null && milesGap > 0 && (
            <p className="mt-1 text-[11px] text-akiba-muted">{milesGap.toLocaleString("en-KE")} Miles to go</p>
          )}
        </div>
      </div>

      <p className="mt-5 font-sterling text-xl font-semibold leading-tight text-akiba-ink">{voucherLabel}</p>
      <h3 className="mt-2 text-sm font-semibold leading-snug text-akiba-ink">{v.title}</h3>
      <p className="mt-1 text-xs leading-5 text-akiba-muted">
        {branchNames ? `Available at ${branchNames.join(", ")}` : "Available at all branches"}
      </p>

      <div className="mt-auto pt-5">
        <GetVoucherButton templateId={v.id} milesCost={v.milesCost} isSignedIn={isSignedIn} />
      </div>
    </article>
  );
}
