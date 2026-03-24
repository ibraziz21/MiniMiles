"use client";

import { useCallback, useEffect, useState } from "react";
import PageWrapper from "@/components/PageWrapper";
import AreaChart from "@/components/charts/AreaChart";
import BarChart from "@/components/charts/BarChart";
import StatCard from "@/components/StatCard";

interface RetentionData {
  dauTrend: { date: string; dau: number }[];
  wauTrend: { week: string; wau: number }[];
  streakHistogram: { range: string; count: number }[];
  activeStreamers: number;
  avgStreak: string;
  cohortRows: {
    week: string;
    cohortSize: number;
    w1: number | null;
    w2: number | null;
    w3: number | null;
    w4: number | null;
  }[];
  funnel: { label: string; value: number; color: string }[];
}

function RetentionCell({ value }: { value: number | null }) {
  if (value === null) {
    return <td className="px-3 py-2 text-center text-gray-600 text-xs">—</td>;
  }
  const color =
    value >= 50
      ? "bg-emerald-500/30 text-emerald-300"
      : value >= 25
      ? "bg-indigo-500/20 text-indigo-300"
      : value >= 10
      ? "bg-amber-500/15 text-amber-400"
      : "bg-gray-700/50 text-gray-500";
  return (
    <td className="px-3 py-2 text-center">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${color}`}>
        {value}%
      </span>
    </td>
  );
}

export default function RetentionPage() {
  const [data, setData] = useState<RetentionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const secret = sessionStorage.getItem("analytics_secret") ?? "";
      const res = await fetch(`/api/retention?secret=${encodeURIComponent(secret)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const maxFunnelValue = data?.funnel[0]?.value ?? 1;

  return (
    <PageWrapper
      title="Retention"
      subtitle="Quest claim retention and current streak health"
      onRefresh={fetchData}
      lastUpdated={lastUpdated}
      loading={loading}
    >
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          Error: {error}
        </div>
      )}

      {/* Streak stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Users with Active Streak"
          value={data?.activeStreamers ?? 0}
          subtitle="Users with streak > 0"
          icon="🔥"
          accent="amber"
          loading={loading}
        />
        <StatCard
          title="Avg Streak Length"
          value={data ? `${data.avgStreak}` : "—"}
          subtitle="Average best current streak"
          icon="📈"
          accent="green"
          loading={loading}
        />
        <StatCard
          title="DAU (Latest)"
          value={data?.dauTrend[data.dauTrend.length - 1]?.dau ?? 0}
          subtitle="Latest daily claimers"
          icon="👤"
          accent="indigo"
          loading={loading}
        />
        <StatCard
          title="WAU (Latest)"
          value={data?.wauTrend[data.wauTrend.length - 1]?.wau ?? 0}
          subtitle="Latest weekly claimers"
          icon="📅"
          accent="blue"
          loading={loading}
        />
      </div>

      {/* DAU / WAU trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">DAU Trend (Last 30 Days)</h3>
          <p className="text-xs text-gray-400 mb-4">Daily unique quest claimers</p>
          {loading ? (
            <div className="h-56 animate-pulse bg-gray-700 rounded-xl" />
          ) : data?.dauTrend ? (
            <AreaChart
              data={data.dauTrend}
              xKey="date"
              lines={[{ key: "dau", name: "DAU", color: "#10b981" }]}
              height={220}
            />
          ) : null}
        </div>

        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">WAU Trend (Last 12 Weeks)</h3>
          <p className="text-xs text-gray-400 mb-4">Weekly unique quest claimers</p>
          {loading ? (
            <div className="h-56 animate-pulse bg-gray-700 rounded-xl" />
          ) : data?.wauTrend ? (
            <AreaChart
              data={data.wauTrend}
              xKey="week"
              lines={[{ key: "wau", name: "WAU", color: "#6366f1" }]}
              height={220}
            />
          ) : null}
        </div>
      </div>

      {/* Streak histogram + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Streak Distribution</h3>
          <p className="text-xs text-gray-400 mb-4">Highest current streak per user across tracked streaks</p>
          {loading ? (
            <div className="h-56 animate-pulse bg-gray-700 rounded-xl" />
          ) : data?.streakHistogram ? (
            <BarChart
              data={data.streakHistogram}
              xKey="range"
              bars={[{ key: "count", name: "Users", color: "#f59e0b" }]}
              height={220}
            />
          ) : null}
        </div>

        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Engagement Funnel</h3>
          <p className="text-xs text-gray-400 mb-4">From registration to claims, streaks, and milestones</p>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse h-12 bg-gray-700 rounded-xl" />
              ))}
            </div>
          ) : data?.funnel ? (
            <div className="space-y-3 mt-2">
              {data.funnel.map((step, i) => {
                const pct = maxFunnelValue > 0 ? (step.value / maxFunnelValue) * 100 : 0;
                const convRate =
                  i > 0 && data.funnel[i - 1].value > 0
                    ? ((step.value / data.funnel[i - 1].value) * 100).toFixed(0)
                    : null;
                return (
                  <div key={step.label}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-300">{step.label}</span>
                      <div className="flex items-center gap-2">
                        {convRate && (
                          <span className="text-xs text-gray-500">→ {convRate}%</span>
                        )}
                        <span className="font-semibold text-white">{step.value.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="h-6 bg-gray-700 rounded-lg overflow-hidden">
                      <div
                        className="h-full rounded-lg transition-all flex items-center px-2"
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          backgroundColor: step.color,
                          opacity: 0.8,
                        }}
                      >
                        <span className="text-xs text-white font-semibold whitespace-nowrap">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Cohort table */}
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
        <h3 className="text-base font-semibold text-white mb-1">Cohort Retention</h3>
        <p className="text-xs text-gray-400 mb-4">
          Users grouped by their first quest-claim week — percentage that returned in subsequent weeks
        </p>
        {loading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse h-10 bg-gray-700 rounded-xl" />
            ))}
          </div>
        ) : data?.cohortRows ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left pb-3 font-medium px-3">Cohort Week</th>
                  <th className="text-center pb-3 font-medium px-3">Users</th>
                  <th className="text-center pb-3 font-medium px-3">Week 1</th>
                  <th className="text-center pb-3 font-medium px-3">Week 2</th>
                  <th className="text-center pb-3 font-medium px-3">Week 3</th>
                  <th className="text-center pb-3 font-medium px-3">Week 4</th>
                </tr>
              </thead>
              <tbody>
                {data.cohortRows.map((row) => (
                  <tr key={row.week} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                    <td className="py-2.5 px-3 text-gray-300 font-medium">{row.week}</td>
                    <td className="py-2.5 px-3 text-center text-indigo-400 font-semibold">
                      {row.cohortSize.toLocaleString()}
                    </td>
                    <RetentionCell value={row.w1} />
                    <RetentionCell value={row.w2} />
                    <RetentionCell value={row.w3} />
                    <RetentionCell value={row.w4} />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-emerald-500/30" />
                <span>≥50% retained</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-indigo-500/20" />
                <span>25–49%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-amber-500/15" />
                <span>10–24%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-gray-700/50" />
                <span>&lt;10%</span>
              </div>
              <div className="flex items-center gap-1">
                <span>—</span>
                <span>Not yet available</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </PageWrapper>
  );
}
