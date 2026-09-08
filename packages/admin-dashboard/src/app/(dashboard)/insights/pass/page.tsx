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
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function MetricCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string;
  value: number | string;
  sub: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium text-slate-500">{title}</CardTitle>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#238D9D]/10">
            <Icon className="h-4 w-4 text-[#238D9D]" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-slate-900">
          {typeof value === "number" ? formatNumber(value) : value}
        </p>
        <p className="mt-1 text-xs text-slate-500">{sub}</p>
      </CardContent>
    </Card>
  );
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
            className="flex h-52 items-end gap-1 border-b border-slate-200 px-1"
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
                    <span className="mb-1 text-[10px] font-medium text-slate-500">{point.signups}</span>
                  ) : null}
                  <div
                    className="w-full min-w-[7px] max-w-8 rounded-t bg-[#238D9D]"
                    style={{ height: `${height}px` }}
                  />
                  <span className="h-7 pt-1 text-[9px] text-slate-400">
                    {index % showEvery === 0 || index === data.length - 1 ? point.date.slice(5) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">Dates use Africa/Nairobi calendar days.</p>
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
      <TopBar title="Pass Analytics" subtitle="Signup and onboarding performance for the Akiba Pass" />
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <form className="flex flex-wrap items-end gap-3" action="/insights/pass">
            <label className="text-xs font-medium text-slate-600">
              <span className="mb-1 block">From</span>
              <input
                type="date"
                name="from"
                defaultValue={range.from}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              <span className="mb-1 block">To</span>
              <input
                type="date"
                name="to"
                defaultValue={range.to}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
              />
            </label>
            <Button type="submit">Apply</Button>
            <div className="flex gap-1">
              {presets.map((preset) => (
                <Link
                  key={preset.days}
                  href={preset.href}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
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
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {rangeError} Showing the latest 30 days instead.
          </div>
        ) : null}

        {error || !analytics ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Pass analytics could not be loaded. Apply migration 072_admin_pass_analytics.sql, then refresh.
            {error ? <p className="mt-1 font-mono text-xs">{error}</p> : null}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard title="Total Passes" value={analytics.total_passes} sub="All time" icon={Users} />
              <MetricCard
                title="Signups today"
                value={analytics.signups_today}
                sub={`${analytics.signups_yesterday} yesterday`}
                icon={UserPlus}
              />
              <MetricCard title="Last 7 days" value={analytics.signups_7_days} sub="Including today" icon={CalendarDays} />
              <MetricCard title="Last 30 days" value={analytics.signups_30_days} sub="Including today" icon={BarChart2} />
              <MetricCard
                title="Selected period"
                value={analytics.period_signups}
                sub={`${range.from} to ${range.to}`}
                icon={CalendarDays}
              />
              <MetricCard
                title="Onboarding reached"
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-y border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                          <th className="px-4 py-3 text-left">Member</th>
                          <th className="px-4 py-3 text-left">Source</th>
                          <th className="px-4 py-3 text-left">Onboarding</th>
                          <th className="px-4 py-3 text-left">Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recent.length === 0 ? (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No Pass signups in this period.</td></tr>
                        ) : null}
                        {recent.map((pass) => (
                          <tr key={pass.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{pass.email}</p>
                              <p className="font-mono text-xs text-slate-400">{pass.user_id}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{sourceLabel(pass.signup_src)}</td>
                            <td className="px-4 py-3">
                              <Badge variant={pass.onboarding_seen_at ? "success" : "secondary"}>
                                {pass.onboarding_seen_at ? "reached" : "not reached"}
                              </Badge>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(pass.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Acquisition sources</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {analytics.sources.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-400">No source data in this period.</p>
                    ) : null}
                    {analytics.sources.map((source) => {
                      const width = percent(source.signups, analytics.period_signups);
                      return (
                        <div key={source.source}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-slate-700">{source.source}</span>
                            <span className="whitespace-nowrap text-slate-500">
                              {formatNumber(source.signups)} · {width}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-[#238D9D]" style={{ width }} />
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
