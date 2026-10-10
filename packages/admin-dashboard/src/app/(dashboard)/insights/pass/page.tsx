import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart2, CalendarDays, Download, Eye, UserPlus, Users } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  defaultPassAnalyticsRange,
  passAnalyticsUtcBounds,
  shiftIsoDate,
  validatePassAnalyticsRange,
  type PassAnalytics,
  type PassAnalyticsRange,
} from "@/lib/passAnalytics";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatNumber } from "@/lib/utils";

type RecentPass = {
  id: string;
  user_id: string;
  email: string;
  signup_src: string | null;
  created_at: string;
  onboarding_seen_at: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rangeUrl(range: Pick<PassAnalyticsRange, "from" | "to">): string {
  return `/insights/pass?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}

function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";
}

function sourceLabel(source: string | null): string {
  return source?.trim() || "Direct / unknown";
}

async function getPassAnalytics(range: PassAnalyticsRange) {
  const { startsAt, endsAt } = passAnalyticsUtcBounds(range);
  const [analyticsRes, recentRes] = await Promise.all([
    supabase.rpc("get_admin_pass_analytics", {
      p_from: range.from,
      p_to: range.to,
    }),
    supabase
      .from("hub_user_passes")
      .select("id, user_id, email, signup_src, created_at, onboarding_seen_at")
      .gte("created_at", startsAt)
      .lt("created_at", endsAt)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return {
    analytics: (analyticsRes.data ?? null) as PassAnalytics | null,
    recent: (recentRes.data ?? []) as RecentPass[],
    error: analyticsRes.error?.message ?? recentRes.error?.message ?? null,
  };
}

function SignupTrend({ data }: { data: PassAnalytics["daily"] }) {
  const maximum = Math.max(1, ...data.map((point) => point.signups));
  const showEvery = data.length <= 31 ? 1 : data.length <= 100 ? 7 : 30;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Pass signups</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-2">
          <div
            className="flex h-52 items-end gap-1 border-b border-border px-1"
            style={{ minWidth: `${Math.max(640, data.length * 16)}px` }}
          >
            {data.map((point, index) => {
              const height = point.signups === 0 ? 2 : Math.max(8, Math.round((point.signups / maximum) * 160));
              return (
                <div
                  key={point.date}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end self-stretch"
                  title={`${point.date}: ${point.signups} signup${point.signups === 1 ? "" : "s"}`}
                >
                  {point.signups > 0 && data.length <= 31 ? (
                    <span className="mb-1 text-[10px] font-medium text-ink-muted">{point.signups}</span>
                  ) : null}
                  <div
                    className="w-full min-w-[7px] max-w-8 rounded-t bg-primary"
                    style={{ height: `${height}px` }}
                  />
                  <span className="h-7 pt-1 text-[9px] text-ink-muted">
                    {index % showEvery === 0 || index === data.length - 1 ? point.date.slice(5) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-muted">Dates use Africa/Nairobi calendar days.</p>
      </CardContent>
    </Card>
  );
}

export default async function PassAnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminSession("users.read");
  if (!session) redirect("/login");

  const fallback = defaultPassAnalyticsRange();
  const requestedFrom = first(searchParams.from);
  const requestedTo = first(searchParams.to);
  const validated = requestedFrom && requestedTo
    ? validatePassAnalyticsRange(requestedFrom, requestedTo)
    : { ok: true as const, value: fallback };
  const range = validated.ok ? validated.value : fallback;
  const rangeError = validated.ok ? null : validated.error;
  const { analytics, recent, error } = await getPassAnalytics(range);

  const presets = [7, 30, 90].map((days) => ({
    days,
    href: rangeUrl({ from: shiftIsoDate(fallback.to, -(days - 1)), to: fallback.to }),
  }));
  const exportUrl = `/api/admin/pass-analytics/export?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;

  return (
    <div>
      <PageHeader title="Pass Analytics" subtitle="Signup and onboarding performance for the Akiba Pass" />
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-card border border-border bg-surface p-4">
          <form className="flex flex-wrap items-end gap-3" action="/insights/pass">
            <label className="text-xs font-medium text-ink-muted">
              <span className="mb-1 block">From</span>
              <input
                type="date"
                name="from"
                defaultValue={range.from}
                className="h-9 rounded-control border border-border bg-surface px-3 text-sm text-ink"
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              <span className="mb-1 block">To</span>
              <input
                type="date"
                name="to"
                defaultValue={range.to}
                className="h-9 rounded-control border border-border bg-surface px-3 text-sm text-ink"
              />
            </label>
            <Button type="submit">Apply</Button>
            <div className="flex gap-1">
              {presets.map((preset) => (
                <Link
                  key={preset.days}
                  href={preset.href}
                  className="inline-flex h-9 items-center rounded-control px-3 text-xs font-medium text-ink-muted hover:bg-surface-subtle"
                >
                  {preset.days}d
                </Link>
              ))}
            </div>
          </form>
          <Button asChild variant="outline">
            <a href={exportUrl}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          </Button>
        </div>

        {rangeError ? (
          <div className="rounded-card border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
            {rangeError} Showing the latest 30 days instead.
          </div>
        ) : null}

        {error || !analytics ? (
          <div className="rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            Pass analytics could not be loaded. Apply migration 072_admin_pass_analytics.sql, then refresh.
            {error ? <p className="mt-1 font-mono text-xs">{error}</p> : null}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="Total Passes" value={formatNumber(analytics.total_passes)} sub="All time" icon={Users} />
              <MetricCard
                label="Signups today"
                value={formatNumber(analytics.signups_today)}
                sub={`${analytics.signups_yesterday} yesterday`}
                icon={UserPlus}
              />
              <MetricCard label="Last 7 days" value={formatNumber(analytics.signups_7_days)} sub="Including today" icon={CalendarDays} />
              <MetricCard label="Last 30 days" value={formatNumber(analytics.signups_30_days)} sub="Including today" icon={BarChart2} />
              <MetricCard
                label="Selected period"
                value={formatNumber(analytics.period_signups)}
                sub={`${range.from} to ${range.to}`}
                icon={CalendarDays}
              />
              <MetricCard
                label="Onboarding reached"
                value={percent(analytics.period_onboarding_seen, analytics.period_signups)}
                sub={`${formatNumber(analytics.period_onboarding_seen)} of ${formatNumber(analytics.period_signups)} selected signups`}
                icon={Eye}
              />
            </div>

            <SignupTrend data={analytics.daily} />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Recent signups in selected period</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {recent.length === 0 ? (
                    <EmptyState message="No Pass signups in this period." isHealthy={false} className="border-0" />
                  ) : (
                    <>
                      {/* Mobile: cards */}
                      <div className="space-y-2 p-4 lg:hidden">
                        {recent.map((pass) => (
                          <div key={pass.id} className="rounded-card border border-border p-3">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-medium text-ink">{pass.email}</p>
                              <Badge variant={pass.onboarding_seen_at ? "success" : "secondary"}>
                                {pass.onboarding_seen_at ? "reached" : "not reached"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-ink-muted">{sourceLabel(pass.signup_src)} · {formatDateTime(pass.created_at)}</p>
                          </div>
                        ))}
                      </div>

                      {/* Desktop: table */}
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-y border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                              <th className="px-4 py-3 text-left">Member</th>
                              <th className="px-4 py-3 text-left">Source</th>
                              <th className="px-4 py-3 text-left">Onboarding</th>
                              <th className="px-4 py-3 text-left">Joined</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {recent.map((pass) => (
                              <tr key={pass.id} className="hover:bg-surface-subtle">
                                <td className="px-4 py-3">
                                  <p className="font-medium text-ink">{pass.email}</p>
                                  <p className="font-mono text-xs text-ink-muted">{pass.user_id}</p>
                                </td>
                                <td className="px-4 py-3 text-ink-muted">{sourceLabel(pass.signup_src)}</td>
                                <td className="px-4 py-3">
                                  <Badge variant={pass.onboarding_seen_at ? "success" : "secondary"}>
                                    {pass.onboarding_seen_at ? "reached" : "not reached"}
                                  </Badge>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{formatDateTime(pass.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Acquisition sources</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {analytics.sources.length === 0 ? (
                      <p className="py-8 text-center text-sm text-ink-muted">No source data in this period.</p>
                    ) : null}
                    {analytics.sources.map((source) => {
                      const width = percent(source.signups, analytics.period_signups);
                      return (
                        <div key={source.source}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-ink-muted">{source.source}</span>
                            <span className="whitespace-nowrap text-ink-muted">
                              {formatNumber(source.signups)} · {width}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
                            <div className="h-full rounded-full bg-primary" style={{ width }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
