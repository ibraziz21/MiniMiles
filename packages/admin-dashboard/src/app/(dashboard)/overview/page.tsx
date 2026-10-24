import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { MetricCard } from "@/components/ui/metric-card";
import { AttentionCard, type AttentionItem } from "@/components/ui/attention-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { getQueueSourceSummaries } from "@/lib/queueSources";
import { getHomeMetrics } from "@/lib/overviewMetrics";
import { hasPermission } from "@/types";
import { Users, Store, Tag, ScrollText, ArrowRight, Landmark, Send, Activity, Coins, UserPlus } from "lucide-react";

interface RecentMerchant {
  id: string;
  name: string;
  country: string | null;
  created_at: string;
  subscription: { plan: string; status: string } | null;
  reviewState: string | null;
}

async function getRecentMerchants(): Promise<RecentMerchant[]> {
  const { data: partners } = await supabase
    .from("partners")
    .select("id, name, country, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  const ids = (partners ?? []).map((partner) => partner.id);
  if (ids.length === 0) return [];

  const [subscriptions, settings] = await Promise.all([
    supabase.from("partner_subscriptions").select("partner_id, plan, status, created_at").in("partner_id", ids).order("created_at", { ascending: false }),
    supabase.from("partner_settings").select("partner_id, directory_status").in("partner_id", ids),
  ]);
  const subscriptionByPartner = new Map<string, { plan: string; status: string }>();
  for (const row of subscriptions.data ?? []) {
    if (!subscriptionByPartner.has(row.partner_id)) {
      subscriptionByPartner.set(row.partner_id, { plan: row.plan, status: row.status });
    }
  }
  const reviewByPartner = new Map((settings.data ?? []).map((row) => [row.partner_id, row.directory_status]));

  return (partners ?? []).map((partner) => ({
    ...partner,
    subscription: subscriptionByPartner.get(partner.id) ?? null,
    reviewState: reviewByPartner.get(partner.id) ?? null,
  }));
}

async function getRecentActivity() {
  const { data } = await supabase
    .from("admin_audit_logs")
    .select("id, action, target_type, target_id, created_at, admin_users(name, email)")
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []) as unknown as Array<{
    id: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    created_at: string;
    admin_users: { name: string | null; email: string } | null;
  }>;
}

export default async function OverviewPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const canSeeUsers = hasPermission(session.role, "users.read");
  const canSeeVouchers = hasPermission(session.role, "vouchers.read") || hasPermission(session.role, "voucher_funds.read");
  const canSeeActivity = hasPermission(session.role, "audit.read");
  const canSeeMerchants = hasPermission(session.role, "merchants.read");
  const canAllocate = hasPermission(session.role, "voucher_funds.write");
  const canIssue = hasPermission(session.role, "voucher_funds.grant");

  const [headline, queueSources, activity, recentMerchants] = await Promise.all([
    getHomeMetrics(session.role),
    getQueueSourceSummaries(session.role),
    canSeeActivity ? getRecentActivity() : Promise.resolve([]),
    canSeeMerchants ? getRecentMerchants() : Promise.resolve([]),
  ]);

  const attentionItems: AttentionItem[] = queueSources.map((s) => ({
    id: s.id,
    label: s.label,
    href: s.href,
    count: s.count,
    oldestAgeMinutes: s.oldestAgeMinutes,
    unavailable: s.unavailable,
  }));

  const value = (metric: number | undefined) => metric === undefined ? "Unavailable" : formatNumber(metric);
  const metrics = headline.metrics;

  return (
    <div>
      <PageHeader title="Home" subtitle="Pass growth, Akiba usage and voucher performance" />

      <div className="space-y-5 p-4 sm:p-6 lg:space-y-6">
        <section aria-labelledby="performance-title" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="performance-title" className="text-xl font-semibold tracking-tight text-ink">Key performance indicators</h2>
              <p className="mt-1 text-sm text-ink-muted">This week starts Monday, {new Date(headline.weekStart).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}. All times EAT.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canSeeUsers && <Button asChild variant="outline" size="sm"><Link href="/usage">Akiba usage</Link></Button>}
              {canSeeUsers && <Button asChild variant="outline" size="sm"><Link href="/insights/pass">Pass metrics</Link></Button>}
            </div>
          </div>
          {headline.unavailable.length > 0 && <p role="status" className="rounded-control border border-warning/30 bg-warning/5 p-3 text-sm text-ink">Some metrics could not be loaded: {headline.unavailable.join(", ")}. <Link href="/overview" className="font-medium text-primary underline">Retry metrics</Link></p>}
          <div className="grid gap-3 min-[375px]:grid-cols-2 xl:grid-cols-3">
            {canSeeUsers && <>
              <MetricCard label="Total Pass users" value={value(metrics.total_pass_users)} sub="All time · Akiba Pass signups" icon={Users} href="/insights/pass" />
              <MetricCard label="New users this week" value={value(metrics.new_users_this_week)} sub="Pass signups · Monday to now" icon={UserPlus} href="/insights/pass" />
              <MetricCard label="Average spend this week" value={metrics.weekly_average_spend === undefined ? "Unavailable" : `${formatNumber(metrics.weekly_average_spend)} miles`} sub="Weekly miles awarded ÷ distinct users awarded" icon={Activity} href="/usage" />
              <MetricCard label="Total users awarded" value={value(metrics.total_users_awarded)} sub="All time · distinct merchant / purchase earners" icon={Users} href="/usage" />
              <MetricCard label="Total miles awarded" value={value(metrics.total_miles_awarded)} sub="All time · merchant and purchase awards" icon={Coins} href="/usage" />
            </>}
            {canSeeVouchers && <MetricCard label="Vouchers redeemed" value={value(metrics.vouchers_redeemed)} sub="All time · completed redemptions" icon={Tag} href={hasPermission(session.role, "voucher_funds.read") ? "/vouchers/issued" : "/vouchers"} />}
          </div>
        </section>

        {(canAllocate || canIssue) && <div className="flex flex-wrap items-center gap-3 border-y border-border py-3">
          <span className="mr-auto text-sm font-medium text-ink">Voucher operations</span>
          {canAllocate && <Button asChild variant="outline" size="sm"><Link href="/vouchers/funds"><Landmark className="h-4 w-4" aria-hidden="true" />Allocate voucher fund</Link></Button>}
          {canIssue && <Button asChild size="sm"><Link href="/vouchers/grants"><Send className="h-4 w-4" aria-hidden="true" />Issue voucher</Link></Button>}
        </div>}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <div className="space-y-5">
            <AttentionCard items={attentionItems} />
            {hasPermission(session.role, "discovery.read") && <Button asChild variant="outline"><Link href="/verified-visits">Browse verified visits<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>}


          </div>

          {canSeeMerchants && (
            <Card className="overflow-hidden border-border shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-ink">New merchants</h2>
                  <p className="text-xs text-ink-muted">Recently onboarded partners</p>
                </div>
                <Button asChild size="sm" variant="ghost"><Link href="/merchants">View all<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              </div>
              {recentMerchants.length === 0 ? (
                <EmptyState icon={Store} message="No merchants have been onboarded yet." className="border-0" />
              ) : (
                <ul className="divide-y divide-border">
                  {recentMerchants.map((merchant) => (
                    <li key={merchant.id}>
                      <Link href={`/merchants/${merchant.id}`} className="group flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary"><Store className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{merchant.name}</span>
                          <span className="block text-xs text-ink-muted">{merchant.country ?? "Country not set"} · {new Date(merchant.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <Badge variant={merchant.subscription?.status === "active" ? "success" : "outline"}>{merchant.subscription?.status?.replaceAll("_", " ") ?? "No plan"}</Badge>
                          {merchant.reviewState && <span className="text-[11px] capitalize text-ink-muted">{merchant.reviewState.replaceAll("_", " ")}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        {canSeeActivity && (
          <details className="group overflow-hidden rounded-card border border-border bg-surface">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-ink marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5">
              <ScrollText className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <span className="flex-1">Administrative activity</span>
              <span className="text-xs font-normal text-ink-muted">{activity.length} recent</span>
              <ArrowRight className="h-4 w-4 rotate-90 text-ink-muted transition-transform group-open:-rotate-90" aria-hidden="true" />
            </summary>
            <div className="border-t border-border">
              {activity.length === 0 ? (
                <EmptyState icon={ScrollText} message="No recent administrative activity." className="border-0" />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((entry) => (
                    <li key={entry.id} className="px-4 py-3 text-sm sm:px-5">
                      <span className="font-medium text-ink">{entry.admin_users?.name ?? entry.admin_users?.email ?? "System"}</span>{" "}
                      <span className="text-ink-muted">{entry.action.replace(/_/g, " ")}</span>
                      {entry.target_type && <span className="text-ink-muted"> · {entry.target_type}</span>}
                      <span className="block text-xs text-ink-muted">{formatDateTime(entry.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
