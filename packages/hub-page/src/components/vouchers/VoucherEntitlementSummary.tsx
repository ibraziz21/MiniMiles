import { ChevronDown } from "lucide-react";
import { entitlementConditions, entitlementDates, entitlementScope, type CustomerVoucherEntitlement } from "@/lib/vouchers/customerEntitlement";

/** The same purchase conditions, dates and merchant scope on every surface. */
export function VoucherEntitlementFacts({ entitlement, showScope = true }: {
  entitlement: CustomerVoucherEntitlement; showScope?: boolean;
}) {
  return <div className="space-y-1 text-xs leading-relaxed text-akiba-muted">
    {entitlementConditions(entitlement).map(line => <p key={line}>{line}</p>)}
    {showScope && <p className="font-semibold text-akiba-ink">{entitlementScope(entitlement)}</p>}
    {entitlementDates(entitlement).map(line => <p key={line}>{line}</p>)}
  </div>;
}

export function VoucherEntitlementSummary({ entitlement: e, interactive = true }: {
  entitlement: CustomerVoucherEntitlement; interactive?: boolean;
}) {
  return <div className="space-y-2" data-entitlement-summary>
    <VoucherEntitlementFacts entitlement={e} />
    {e.merchantCount > 1 && (interactive ? (
      <details className="group rounded-xl bg-akiba-card px-3 text-xs">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible focus-visible:ring-offset-2">
          See the {e.merchantCount} merchants
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <ul className="pb-2">
          {e.merchants.map(merchant => <li key={merchant.id || merchant.slug}>
            <a href={`/merchants/${merchant.slug}`} className="flex min-h-11 items-center rounded-lg px-2 py-2 font-medium text-akiba-tealAccessible underline-offset-2 hover:bg-akiba-tint hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible">{merchant.name}</a>
          </li>)}
        </ul>
      </details>
    ) : <ul className="space-y-1 text-sm text-akiba-ink">{e.merchants.map(merchant => <li key={merchant.id || merchant.slug}>{merchant.name}</li>)}</ul>)}
    {e.merchantsIncomplete && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
      Details for {e.merchantCount - e.merchants.length} of these {e.merchantCount} merchants are unavailable.
    </p>}
    {e.terms && (interactive ? <details className="group rounded-xl border border-akiba-line px-3 text-xs">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible">Terms<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
      <p className="whitespace-pre-wrap pb-3 leading-relaxed text-akiba-muted">{e.terms}</p>
    </details> : <p className="whitespace-pre-wrap text-xs leading-relaxed text-akiba-muted">{e.terms}</p>)}
  </div>;
}
