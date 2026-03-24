"use client";

import { useCallback, useEffect, useState } from "react";
import PageWrapper from "@/components/PageWrapper";
import StatCard from "@/components/StatCard";
import AreaChart from "@/components/charts/AreaChart";

interface OverviewData {
  totalUsers: number;
  activeUsers: number;
  dau: number;
  mau: number;
  wau: number | null;
  totalMinted: number;
  mintQueue: {
    pendingCount: number;
    pendingTotal: number;
    failedCount: number;
    failedTotal: number;
  };
  claimsToday: number;
  claimsYesterday: number;
  totalReferrals: number;
  raffleMetric: number | null;
  dauTrend: { date: string; dau: number }[];
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-700 rounded-xl ${className}`} />;
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const secret = sessionStorage.getItem("analytics_secret") ?? "";
      const res = await fetch(`/api/overview?secret=${encodeURIComponent(secret)}`);
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

  const claimsDelta =
    data && data.claimsYesterday > 0
      ? Math.round(((data.claimsToday - data.claimsYesterday) / data.claimsYesterday) * 100)
      : 0;

  return (
    <PageWrapper
      title="Overview"
      subtitle="High-level metrics for the AkibaMiles platform"
      onRefresh={fetchData}
      lastUpdated={lastUpdated}
      loading={loading}
    >
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          Error loading data: {error}
        </div>
      )}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Registered Users"
          value={data?.totalUsers ?? 0}
          icon="👥"
          accent="green"
          loading={loading}
        />
        <StatCard
          title="Lifetime AkibaMiles Users"
          value={data?.activeUsers ?? 0}
          subtitle="Prefer Dune-backed value when configured"
          icon="⚡"
          accent="indigo"
          loading={loading}
        />
        <StatCard
          title="Weekly Active Users"
          value={data?.wau ?? 0}
          subtitle="Prefer Dune-backed WAU"
          icon="📆"
          accent="amber"
          loading={loading}
        />
        <StatCard
          title="Quest Claims Today"
          value={data?.claimsToday ?? 0}
          trend={
            data && data.claimsYesterday > 0
              ? { value: claimsDelta, label: "vs yesterday" }
              : undefined
          }
          icon="🎯"
          accent="blue"
          loading={loading}
        />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total AkibaMiles Minted"
          value={data ? data.totalMinted.toLocaleString() : "—"}
          subtitle="From completed mint jobs"
          icon="🪙"
          accent="green"
          loading={loading}
        />
        <StatCard
          title="Raffle Metric"
          value={data?.raffleMetric ?? 0}
          subtitle="Dune-backed when configured"
          icon="🎰"
          accent="indigo"
          loading={loading}
        />
        <StatCard
          title="Total Referrals Redeemed"
          value={data?.totalReferrals ?? 0}
          icon="🔗"
          accent="blue"
          loading={loading}
        />
        <StatCard
          title="Yesterday's Claims"
          value={data?.claimsYesterday ?? 0}
          icon="📋"
          accent="amber"
          loading={loading}
        />
      </div>

      {/* Mint Queue Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-800 rounded-2xl border border-amber-500/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">⏳</span>
            <h3 className="text-sm font-semibold text-gray-200">Mint Queue — Pending</h3>
            {loading && <div className="ml-auto w-4 h-4 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />}
          </div>
          {loading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-8 w-24" />
              <SkeletonBlock className="h-4 w-40" />
            </div>
          ) : (
            <>
              <div className="text-3xl font-bold text-amber-400">
                {data?.mintQueue.pendingCount.toLocaleString() ?? 0}
              </div>
              <div className="text-sm text-gray-400 mt-1">
                {data?.mintQueue.pendingTotal.toLocaleString() ?? 0} points pending
              </div>
              <div className="mt-3 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all"
                  style={{
                    width: data
                      ? `${Math.min(100, (data.mintQueue.pendingCount / Math.max(data.mintQueue.pendingCount + data.mintQueue.failedCount + 1, 1)) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="bg-gray-800 rounded-2xl border border-red-500/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">❌</span>
            <h3 className="text-sm font-semibold text-gray-200">Mint Queue — Failed</h3>
            {data && data.mintQueue.failedCount > 0 && (
              <span className="ml-auto text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full border border-red-500/20">
                Action needed
              </span>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-8 w-24" />
              <SkeletonBlock className="h-4 w-40" />
            </div>
          ) : (
            <>
              <div className="text-3xl font-bold text-red-400">
                {data?.mintQueue.failedCount.toLocaleString() ?? 0}
              </div>
              <div className="text-sm text-gray-400 mt-1">
                {data?.mintQueue.failedTotal.toLocaleString() ?? 0} points failed
              </div>
              {data && data.mintQueue.failedCount === 0 && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  All clear — no failures
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 7-Day DAU Chart */}
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-base font-semibold text-white">7-Day DAU Trend</h3>
            <p className="text-sm text-gray-400 mt-0.5">Daily active users over the past week</p>
          </div>
        </div>
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-pulse text-gray-500">Loading chart...</div>
          </div>
        ) : data?.dauTrend ? (
          <AreaChart
            data={data.dauTrend}
            xKey="date"
            lines={[{ key: "dau", name: "Daily Active Users", color: "#10b981" }]}
            height={260}
          />
        ) : null}
      </div>
    </PageWrapper>
  );
}
