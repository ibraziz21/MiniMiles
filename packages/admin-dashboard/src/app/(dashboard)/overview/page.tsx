import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AttentionInbox } from "@/components/overview/AttentionInbox";
import { PageHeader } from "@/components/shell/PageHeader";
import { getOverviewCharts, overviewDays } from "@/lib/overviewCharts";
import { SignupChart } from "@/components/overview/SignupChart";
import { TrendPeriod } from "@/components/overview/TrendPeriod";
import { MetricCard } from "@/components/ui/metric-card";
import { type AttentionItem } from "@/components/ui/attention-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { getQueueSourceSummaries } from "@/lib/queueSources";
import { getHomeMetrics } from "@/lib/overviewMetrics";
import { hasPermission } from "@/types";
import {
  Store,
  ScrollText,
  ArrowRight,
  Landmark,
  Send,
  Coins,
} from "lucide-react";

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
    supabase
      .from("partner_subscriptions")
      .select("partner_id, plan, status, created_at")
      .in("partner_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from("partner_settings")
      .select("partner_id, directory_status")
      .in("partner_id", ids),
  ]);
  const subscriptionByPartner = new Map<
    string,
    { plan: string; status: string }
  >();
  for (const row of subscriptions.data ?? []) {
    if (!subscriptionByPartner.has(row.partner_id)) {
      subscriptionByPartner.set(row.partner_id, {
        plan: row.plan,
        status: row.status,
      });
    }
  }
  const reviewByPartner = new Map(
    (settings.data ?? []).map((row) => [row.partner_id, row.directory_status])
  );

  return (partners ?? []).map((partner) => ({
    ...partner,
    subscription: subscriptionByPartner.get(partner.id) ?? null,
    reviewState: reviewByPartner.get(partner.id) ?? null,
  }));
}

async function getRecentActivity() {
  const { data } = await supabase
    .from("admin_audit_logs")
    .select(
      "id, action, target_type, target_id, created_at, admin_users(name, email)"
    )
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

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { days?: string | string[] };
}) {
  const days = overviewDays(searchParams.days);
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const canSeeUsers = hasPermission(session.role, "users.read");
  const canSeeVouchers =
    hasPermission(session.role, "vouchers.read") ||
    hasPermission(session.role, "voucher_funds.read");
  const canSeeActivity = hasPermission(session.role, "audit.read");
  const canSeeMerchants = hasPermission(session.role, "merchants.read");
  const canAllocate = hasPermission(session.role, "voucher_funds.write");
  const canIssue = hasPermission(session.role, "voucher_funds.grant");

  const [headline, queueSources, activity, recentMerchants, charts] =
    await Promise.all([
      getHomeMetrics(session.role),
      getQueueSourceSummaries(session.role),
      canSeeActivity ? getRecentActivity() : Promise.resolve([]),
      canSeeMerchants ? getRecentMerchants() : Promise.resolve([]),
      getOverviewCharts(session.role, days),
    ]);

  const attentionItems: AttentionItem[] = queueSources.map((s) => ({
    id: s.id,
    label: s.label,
    href: s.href,
    count: s.count,
    oldestAgeMinutes: s.oldestAgeMinutes,
    unavailable: s.unavailable,
  }));

  const value = (metric: number | undefined) =>
    metric === undefined ? "Unavailable" : formatNumber(metric);
  const metrics = headline.metrics;

  return (
    <div>
      <PageHeader
        title="Akiba Admin"
        headingLevel={2}
        actions={<AttentionInbox items={attentionItems} />}
      />

      <div className="space-y-5 p-4 sm:p-6 lg:space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-ink sm:text-[32px]">
              Overview
            </h1>
            {canSeeMerchants && (
              <p className="mt-1 text-sm text-ink-muted">
                {charts.activeMerchants === null
                  ? "Merchant count unavailable"
                  : `${formatNumber(charts.activeMerchants)} active merchants`}
              </p>
            )}
          </div>
          {canSeeUsers && <TrendPeriod days={days} />}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-3">
          {canSeeUsers && (
            <section
              aria-labelledby="signup-title"
              className="min-w-0 rounded-card bg-[#242225] p-5 text-white sm:p-6 lg:col-span-2 xl:col-span-2"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="signup-title" className="text-base font-medium">
                  Pass signups
                </h2>
                <Link
                  href={`/insights/pass?from=${charts.from}&to=${charts.to}`}
                  aria-label="View Pass signup analytics"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  <ArrowRight
                    className="h-5 w-5 -rotate-45"
                    aria-hidden="true"
                  />
                </Link>
              </div>
              <p className="mt-2 break-words text-4xl font-semibold tracking-tight tabular-nums sm:text-[44px]">
                {charts.passes
                  ? formatNumber(charts.passes.period_signups)
                  : "Unavailable"}
              </p>
              <p className="mt-1 text-sm text-white/75">
                Last {days} days · includes today · EAT
              </p>
              {charts.passes ? (
                <SignupChart
                  key={`${charts.from}-${charts.to}`}
                  daily={charts.passes.daily}
                />
              ) : (
                <p role="status" className="py-12 text-sm text-white/80">
                  Couldn’t load signups.{" "}
                  <Link
                    href={`/overview?days=${days}`}
                    className="underline underline-offset-4"
                  >
                    Try again
                  </Link>
                </p>
              )}
            </section>
          )}

          <div className="min-w-0 space-y-4">
            {canSeeUsers && (
              <section
                aria-labelledby="miles-title"
                className="rounded-card bg-primary p-4 text-white sm:p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 id="miles-title" className="text-base font-medium">
                    Miles awarded
                  </h2>
                  <Coins className="h-5 w-5 text-white/80" aria-hidden="true" />
                </div>
                <p className="mt-4 break-words text-4xl font-semibold tracking-tight tabular-nums">
                  {value(metrics.total_miles_awarded)}
                </p>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/20 pt-3 text-sm">
                  <span>All time</span>
                  <Link
                    href="/usage?period=all#earnings"
                    className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 font-medium hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  >
                    View earnings
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </section>
            )}
            {hasPermission(session.role, "voucher_settlements.read") && (
              <section
                aria-labelledby="reimbursements-title"
                className="rounded-card border border-border bg-white p-4 sm:p-6"
              >
                <h2
                  id="reimbursements-title"
                  className="text-base font-medium text-ink"
                >
                  Voucher reimbursements
                </h2>
                {charts.finance ? (
                  <>
                    <p className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums text-ink">
                      <span className="text-lg font-normal">KES </span>
                      {formatNumber(charts.finance.outstanding)}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Awaiting payment · all time
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                      <span className="text-ink-muted">
                        Paid{" "}
                        <strong className="font-medium tabular-nums text-ink">
                          KES {formatNumber(charts.finance.paid)}
                        </strong>
                      </span>
                      <Link
                        href="/finance/voucher-reimbursements"
                        className="inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-medium text-primary hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        View
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </>
                ) : (
                  <p role="status" className="mt-4 text-sm text-ink-muted">
                    Reimbursements unavailable.{" "}
                    <Link
                      href={`/overview?days=${days}`}
                      className="text-primary underline"
                    >
                      Try again
                    </Link>
                  </p>
                )}
              </section>
            )}
          </div>
        </div>

        <section aria-labelledby="performance-title" className="space-y-3">
          <h2 id="performance-title" className="sr-only">
            Key performance indicators
          </h2>
          {headline.unavailable.length > 0 && (
            <p
              role="status"
              className="rounded-control border border-warning/30 bg-warning/5 p-3 text-sm text-ink"
            >
              Some metrics are unavailable.{" "}
              <Link
                href={`/overview?days=${days}`}
                className="font-medium text-primary underline"
              >
                Retry
              </Link>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            {canSeeUsers && (
              <>
                <MetricCard
                  compact
                  label="Total Pass users"
                  value={value(metrics.total_pass_users)}
                  sub="All time"
                  href="/insights/pass"
                />
                <MetricCard
                  compact
                  label="New users this week"
                  value={value(metrics.new_users_this_week)}
                  sub="Since Monday · EAT"
                  href="/insights/pass"
                />
                <MetricCard
                  compact
                  label="Average Miles per earner"
                  value={value(metrics.weekly_average_spend)}
                  sub="This week"
                  href="/usage?period=week#earnings"
                />
                <MetricCard
                  compact
                  label="Total users awarded"
                  value={value(metrics.total_users_awarded)}
                  sub="All time"
                  href="/usage?period=all#earnings"
                />
              </>
            )}
            {canSeeVouchers && (
              <MetricCard
                compact
                label="Vouchers redeemed"
                value={value(metrics.vouchers_redeemed)}
                sub="All time"
                href={
                  hasPermission(session.role, "voucher_funds.read")
                    ? "/vouchers/issued"
                    : "/vouchers"
                }
              />
            )}
          </div>
        </section>

        {canSeeUsers && (
          <section
            aria-labelledby="merchant-earnings-title"
            className="rounded-card border border-border bg-white p-4 sm:p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2
                  id="merchant-earnings-title"
                  className="text-lg font-semibold text-ink"
                >
                  Miles by merchant
                </h2>
                <p className="mt-1 text-sm text-ink-muted">Top 5 · all time</p>
              </div>
              <Link
                href="/usage?period=all#earnings"
                className="inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-2 text-sm font-medium text-primary hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                View all
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            {charts.merchants === null ? (
              <p role="status" className="py-8 text-sm text-ink-muted">
                Merchant earnings unavailable.{" "}
                <Link
                  href={`/overview?days=${days}`}
                  className="text-primary underline"
                >
                  Try again
                </Link>
              </p>
            ) : charts.merchants.length === 0 ? (
              <p className="py-8 text-sm text-ink-muted">
                No merchant awards yet.
              </p>
            ) : (
              <ul className="mt-5 space-y-2">
                {charts.merchants.map((merchant) => (
                  <li key={merchant.merchant_key}>
                    <Link
                      href={`/usage/merchants/${encodeURIComponent(
                        merchant.merchant_key
                      )}?period=all`}
                      className="block rounded-control p-2 hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words font-medium text-ink">
                          {merchant.merchant_name}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink-muted">
                          {formatNumber(merchant.miles_awarded)} Miles
                        </span>
                      </div>
                      <div
                        className="h-2 rounded-full bg-surface-subtle"
                        aria-hidden="true"
                      >
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(
                                100,
                                (merchant.miles_awarded /
                                  Math.max(
                                    1,
                                    charts.merchants![0].miles_awarded
                                  )) *
                                  100
                              )
                            )}%`,
                          }}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {(canAllocate || canIssue) && (
          <div className="flex flex-wrap items-center gap-3 border-y border-border py-3">
            <span className="mr-auto text-sm font-medium text-ink">
              Voucher operations
            </span>
            {canAllocate && (
              <Button asChild variant="outline" size="sm">
                <Link href="/vouchers/funds">
                  <Landmark className="h-4 w-4" aria-hidden="true" />
                  Allocate voucher fund
                </Link>
              </Button>
            )}
            {canIssue && (
              <Button asChild size="sm">
                <Link href="/vouchers/grants">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Issue voucher
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <div className="space-y-5">
            {hasPermission(session.role, "discovery.read") && (
              <Button asChild variant="outline">
                <Link href="/verified-visits">
                  Browse verified visits
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>

          {canSeeMerchants && (
            <Card className="overflow-hidden border-border shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-ink">
                    New merchants
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Recently onboarded partners
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/merchants">
                    View all
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              {recentMerchants.length === 0 ? (
                <EmptyState
                  icon={Store}
                  message="No merchants have been onboarded yet."
                  className="border-0"
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recentMerchants.map((merchant) => (
                    <li key={merchant.id}>
                      <Link
                        href={`/merchants/${merchant.id}`}
                        className="group flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                          <Store className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {merchant.name}
                          </span>
                          <span className="block text-xs text-ink-muted">
                            {merchant.country ?? "Country not set"} ·{" "}
                            {new Date(merchant.created_at).toLocaleDateString(
                              "en-KE",
                              { day: "numeric", month: "short" }
                            )}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <Badge
                            variant={
                              merchant.subscription?.status === "active"
                                ? "success"
                                : "outline"
                            }
                          >
                            {merchant.subscription?.status?.replaceAll(
                              "_",
                              " "
                            ) ?? "No plan"}
                          </Badge>
                          {merchant.reviewState && (
                            <span className="text-[11px] capitalize text-ink-muted">
                              {merchant.reviewState.replaceAll("_", " ")}
                            </span>
                          )}
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
              <ScrollText
                className="h-4 w-4 text-ink-muted"
                aria-hidden="true"
              />
              <span className="flex-1">Administrative activity</span>
              <span className="text-xs font-normal text-ink-muted">
                {activity.length} recent
              </span>
              <ArrowRight
                className="h-4 w-4 rotate-90 text-ink-muted transition-transform group-open:-rotate-90"
                aria-hidden="true"
              />
            </summary>
            <div className="border-t border-border">
              {activity.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  message="No recent administrative activity."
                  className="border-0"
                />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((entry) => (
                    <li key={entry.id} className="px-4 py-3 text-sm sm:px-5">
                      <span className="font-medium text-ink">
                        {entry.admin_users?.name ??
                          entry.admin_users?.email ??
                          "System"}
                      </span>{" "}
                      <span className="text-ink-muted">
                        {entry.action.replace(/_/g, " ")}
                      </span>
                      {entry.target_type && (
                        <span className="text-ink-muted">
                          {" "}
                          · {entry.target_type}
                        </span>
                      )}
                      <span className="block text-xs text-ink-muted">
                        {formatDateTime(entry.created_at)}
                      </span>
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
