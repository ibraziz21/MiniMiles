import Link from "next/link";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { formatNumber } from "@/lib/utils";
import { formatSpendKes, type EarningBreakdown, type EarningPeriod } from "@/lib/earningBreakdown";

export function EarningBreakdownView({ data, error, period, page, merchantKey }: {
  data: EarningBreakdown | null; error: boolean; period: EarningPeriod; page: number; merchantKey?: string;
}) {
  const path = merchantKey ? `/usage/merchants/${merchantKey}` : "/usage";
  const href = (p: number) => `${path}?period=${period}&page=${p}#earnings`;
  const periodLabel = period === "week" ? "This week" : "All time";
  return <section id="earnings" aria-labelledby="earnings-title" className="scroll-mt-4 space-y-4">
    {merchantKey && <Link href={`/usage?period=${period}#earnings`} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4"><ChevronLeft className="h-4 w-4" aria-hidden="true" />All merchants</Link>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="earnings-title" className="text-xl font-semibold tracking-tight text-ink">{merchantKey ? "Individual earners" : "Miles earned by merchant"}</h2>
        <p className="mt-1 text-sm text-ink-muted">{periodLabel}{period === "week" ? " · Monday 00:00 to now, Africa/Nairobi" : " · All recorded merchant and purchase awards"}</p>
      </div>
      <nav aria-label="Earning period" className="flex gap-2">
        {([ ["week", "This week"], ["all", "All time"] ] as const).map(([id, label]) => <Link key={id} href={`${path}?period=${id}#earnings`} aria-current={id === period ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${id === period ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink hover:bg-surface-subtle"}`}>{label}</Link>)}
      </nav>
    </div>
    <p className="max-w-3xl text-sm leading-6 text-ink-muted">Estimated spend value = miles earned × KES 100. This is spend inferred from the earning rule, before reversals; it is not the cash value of miles or a receipt total.</p>
    {error || !data ? <div role="alert" className="rounded-card border border-warning/30 bg-warning/5 p-4 text-sm text-ink">Earning details could not be loaded. <Link href={href(page)} className="font-medium text-primary underline">Retry earning details</Link></div> : <>
      <div className="grid gap-3 min-[375px]:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Distinct earners" value={formatNumber(data.users_awarded)} sub={merchantKey ? "Users earning at this merchant" : "Users counted once across all merchants"} />
        <MetricCard label="Miles earned" value={formatNumber(data.miles_awarded)} sub="Gross merchant and purchase awards" />
        <MetricCard label="Miles per earner" value={formatNumber(data.miles_per_user)} sub="Total miles ÷ distinct earners" />
        <MetricCard label="Estimated spend value" value={formatSpendKes(data.estimated_spend_kes)} sub="KES 100 of spend per mile earned" />
      </div>
      {!merchantKey && <p className="text-sm text-ink-muted">Choose a merchant to see each user’s miles earned and estimated spend value. Users earning at multiple merchants appear at each merchant; the distinct total above counts them once.</p>}
      {data.total_rows === 0 ? <p className="rounded-card border border-border bg-surface p-6 text-sm text-ink">No miles earned {merchantKey ? "at this merchant " : ""}{period === "week" ? "this week" : "yet"}.</p> : <>
        <p className="text-sm text-ink-muted">{formatNumber(data.total_rows)} {merchantKey ? "earning users" : "merchants"} · Highest miles earned first</p>
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {merchantKey ? data.members.map(member => <li key={member.member_id} className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><h3 className="break-words text-base font-semibold text-ink">{member.username ? `@${member.username}` : `Member ${member.member_id.slice(0, 8)}`}</h3><p className="mt-1 break-all text-xs text-ink-muted">Member ID: {member.member_id}</p></div>
              <span className="text-xs text-ink-muted">Last earned {new Date(member.last_earned_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" })}</span>
            </div>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <EarningValue label="Miles earned" value={formatNumber(member.miles_awarded)} />
              <EarningValue label="Estimated spend value" value={formatSpendKes(member.estimated_spend_kes)} />
              <EarningValue label="Awards" value={formatNumber(member.award_count)} />
            </dl>
          </li>) : data.merchants.map(merchant => <li key={merchant.merchant_key} className="space-y-3 p-4 sm:p-5">
            <Link href={`/usage/merchants/${merchant.merchant_key}?period=${period}`} className="group flex min-h-11 items-center justify-between gap-3 rounded-control text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <h3 className="min-w-0 break-words text-base font-semibold">{merchant.merchant_name}</h3>
              <span className="flex shrink-0 items-center gap-1 text-sm font-medium">View earners<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
            </Link>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <EarningValue label="Earning users" value={formatNumber(merchant.users_awarded)} />
              <EarningValue label="Miles earned" value={formatNumber(merchant.miles_awarded)} />
              <EarningValue label="Miles per earner" value={formatNumber(merchant.miles_per_user)} />
              <EarningValue label="Estimated spend value" value={formatSpendKes(merchant.estimated_spend_kes)} />
            </dl>
          </li>)}
        </ul>
      </>}
      <nav aria-label="Earning breakdown pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {page > 1 ? <Link href={href(page - 1)} className="inline-flex min-h-11 items-center font-medium text-primary underline">Previous</Link> : <span />}
        <span className="text-ink-muted">Page {formatNumber(page)} of {formatNumber(Math.max(1, Math.ceil(data.total_rows / 25)))}</span>
        {page * 25 < data.total_rows ? <Link href={href(page + 1)} className="inline-flex min-h-11 items-center font-medium text-primary underline">Next</Link> : <span />}
      </nav>
    </>}
  </section>;
}

function EarningValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums text-ink">{value}</dd></div>;
}
