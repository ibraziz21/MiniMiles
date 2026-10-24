import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { getHomeMetrics } from "@/lib/overviewMetrics";
import { PageHeader } from "@/components/shell/PageHeader";
import { MetricCard } from "@/components/ui/metric-card";
import { formatNumber } from "@/lib/utils";

export default async function UsagePage() {
  const session = await requireAdminSession("users.read");
  if (!session) redirect("/login");
  const { metrics, unavailable } = await getHomeMetrics(session.role);
  const value = (n: number | undefined) => n === undefined ? "Unavailable" : formatNumber(n);
  return <>
    <PageHeader title="Akiba usage" subtitle="Merchant and purchase miles awarded to Akiba users" />
    <div className="space-y-5 p-4 sm:p-6">
      {unavailable.includes("Akiba usage") && <p role="status" className="rounded-card border border-warning/30 p-4 text-sm">Usage metrics could not be loaded. <Link href="/usage" className="text-primary underline">Retry usage metrics</Link></p>}
      <section aria-labelledby="weekly-title" className="space-y-3">
        <h2 id="weekly-title" className="text-lg font-semibold text-ink">This week</h2>
        <p className="text-sm text-ink-muted">Monday 00:00 to now, Africa/Nairobi.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Users awarded this week" value={value(metrics.weekly_users_awarded)} sub="Distinct earning users" />
          <MetricCard label="Miles awarded this week" value={value(metrics.weekly_miles_awarded)} sub="Merchant and purchase credits" />
          <MetricCard label="Average spend this week" value={value(metrics.weekly_average_spend)} sub="Miles awarded ÷ distinct users awarded · miles per user" />
        </div>
      </section>
      <section aria-labelledby="totals-title" className="space-y-3">
        <h2 id="totals-title" className="text-lg font-semibold text-ink">All time</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label="Total users awarded" value={value(metrics.total_users_awarded)} />
          <MetricCard label="Total miles awarded" value={value(metrics.total_miles_awarded)} />
        </div>
      </section>
      <p className="max-w-3xl text-sm leading-6 text-ink-muted">Awards count positive merchant and purchase credits in the miles ledger. Users are counted once by canonical identity. These are gross awards before reversals; games, campaigns and referral rewards are excluded. Average spend is measured in miles per awarded user.</p>
    </div>
  </>;
}
