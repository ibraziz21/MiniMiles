import Link from "next/link";
import { ArrowRight, ChevronRight, Clock3, TicketCheck } from "lucide-react";
import type { OwnedVoucherPreviewResult } from "@/lib/akiba/myVouchers";

export function MyVouchersSection({ preview }: { preview: OwnedVoucherPreviewResult }) {
  const { items, totalCount } = preview;

  return (
    <section className="mb-7" aria-labelledby="my-vouchers-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="my-vouchers-heading" className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">
            My vouchers
          </h2>
          <p className="mt-0.5 text-xs text-akiba-muted sm:text-sm">
            {totalCount > 0
              ? `${totalCount} ${totalCount === 1 ? "voucher" : "vouchers"} ready or being prepared.`
              : "Vouchers you own will appear here."}
          </p>
        </div>
        {totalCount > 0 && (
          <Link
            href="/vouchers?tab=active"
            className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint hover:text-akiba-tealDark active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-akiba-line bg-white p-3.5 sm:p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-akiba-tint text-akiba-teal">
            <TicketCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-akiba-ink">No vouchers yet</p>
            <p className="mt-0.5 text-xs text-akiba-muted">Claim a free offer or use Miles for a reward.</p>
          </div>
          <Link
            href="/vouchers?tab=available"
            className="flex min-h-11 shrink-0 items-center rounded-full bg-akiba-ink px-3.5 text-xs font-semibold text-white transition hover:bg-akiba-teal active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            Browse
          </Link>
        </div>
      ) : (
        <div className={`grid gap-3 ${items.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {items.map((voucher) => {
            const isReady = voucher.status === "issued";
            return (
              <Link
                key={voucher.id}
                href={`/vouchers/${voucher.id}`}
                className="group relative flex min-h-28 items-center gap-3 overflow-hidden rounded-2xl border border-akiba-teal/20 bg-white py-3 pl-4 pr-3 transition hover:border-akiba-teal/40 hover:shadow-chip active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal motion-reduce:transform-none"
              >
                <span className={`absolute inset-y-0 left-0 w-1 ${isReady ? "bg-akiba-teal" : "bg-amber-400"}`} aria-hidden="true" />
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-akiba-line bg-akiba-card">
                  {voucher.merchantLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={voucher.merchantLogoUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    <TicketCheck className="h-5 w-5 text-akiba-teal" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-akiba-muted">{voucher.merchantName}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${isReady ? "bg-akiba-tint text-akiba-teal" : "bg-amber-50 text-amber-700"}`}>
                      {isReady ? "Ready" : "Preparing"}
                    </span>
                  </span>
                  <span className="mt-1 block truncate font-sterling text-lg font-semibold leading-tight text-akiba-ink">
                    {voucher.valueLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-akiba-muted">{voucher.title}</span>
                  {voucher.expiresAt && (
                    <span className="mt-1.5 flex items-center gap-1 text-[11px] text-akiba-muted">
                      <Clock3 className="h-3 w-3" aria-hidden="true" /> Expires {formatVoucherDate(voucher.expiresAt)}
                    </span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-akiba-line transition group-hover:translate-x-0.5 group-hover:text-akiba-teal" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatVoucherDate(value: string): string {
  return new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}
