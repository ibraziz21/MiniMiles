export function FundedDiscoveryNotice({ href = "/vouchers?tab=claimable" }: { href?: string }) {
  return <div role="status" className="my-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
    Free offers are temporarily unavailable. <a href={href} className="inline-flex min-h-11 items-center font-semibold underline">Try again</a>
  </div>;
}
