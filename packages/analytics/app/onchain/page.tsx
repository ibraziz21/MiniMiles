"use client";

import { useCallback, useEffect, useState } from "react";
import PageWrapper from "@/components/PageWrapper";
import PieChart from "@/components/charts/PieChart";
import AreaChart from "@/components/charts/AreaChart";
import StatCard from "@/components/StatCard";

interface OnChainData {
  pieData: {
    name: string;
    value: number;
    count: number;
    color: string;
  }[];
  dailyVolume: { date: string; points: number }[];
  top20Earners: {
    rank: number;
    address: string;
    shortAddress: string;
    totalPoints: number;
  }[];
  statusBreakdown: {
    status: string;
    count: number;
    points: number;
    color: string;
  }[];
}

export default function OnChainPage() {
  const [data, setData] = useState<OnChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const secret = sessionStorage.getItem("analytics_secret") ?? "";
      const res = await fetch(`/api/onchain?secret=${encodeURIComponent(secret)}`);
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

  const totalMinted = data?.pieData.reduce((sum, d) => sum + d.value, 0) ?? 0;
  const completedStatus = data?.statusBreakdown.find((s) => s.status === "completed");

  return (
    <PageWrapper
      title="Mint Pipeline"
      subtitle="Queued mint-job distribution, throughput, and top recipients"
      onRefresh={fetchData}
      lastUpdated={lastUpdated}
      loading={loading}
    >
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          Error: {error}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Points Minted"
          value={totalMinted ? totalMinted.toLocaleString() : "—"}
          icon="🪙"
          accent="green"
          loading={loading}
        />
        <StatCard
          title="Completed Mint Jobs"
          value={completedStatus?.count ?? 0}
          icon="✅"
          accent="green"
          loading={loading}
        />
        <StatCard
          title="Pending Mint Jobs"
          value={data?.statusBreakdown.find((s) => s.status === "pending")?.count ?? 0}
          icon="⏳"
          accent="amber"
          loading={loading}
        />
        <StatCard
          title="Failed Mint Jobs"
          value={data?.statusBreakdown.find((s) => s.status === "failed")?.count ?? 0}
          icon="❌"
          accent="red"
          loading={loading}
        />
      </div>

      {/* Pie + Status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Category Pie */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Points by Category</h3>
          <p className="text-xs text-gray-400 mb-4">Distribution of queued mint-job points by reason type</p>
          {loading ? (
            <div className="h-72 animate-pulse bg-gray-700 rounded-xl" />
          ) : data?.pieData ? (
            <PieChart data={data.pieData} height={300} />
          ) : null}
        </div>

        {/* Mint job status breakdown */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Mint Job Status Breakdown</h3>
          <p className="text-xs text-gray-400 mb-4">All-time job counts and points by status</p>
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse h-16 bg-gray-700 rounded-xl" />
              ))}
            </div>
          ) : data?.statusBreakdown ? (
            <div className="space-y-3 mt-4">
              {data.statusBreakdown.map((s) => {
                const totalCount = data.statusBreakdown.reduce((sum, d) => sum + d.count, 0);
                const pct = totalCount > 0 ? (s.count / totalCount) * 100 : 0;
                return (
                  <div key={s.status} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="capitalize text-gray-300">{s.status}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-200 font-medium">{s.count.toLocaleString()}</span>
                        <span className="text-gray-500 text-xs ml-2">({pct.toFixed(1)}%)</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: s.color }}
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      {s.points.toLocaleString()} points
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Daily minting volume */}
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 mb-6">
        <h3 className="text-base font-semibold text-white mb-1">Daily Minting Volume</h3>
        <p className="text-xs text-gray-400 mb-4">Points minted per day from completed queue jobs</p>
        {loading ? (
          <div className="h-64 animate-pulse bg-gray-700 rounded-xl" />
        ) : data?.dailyVolume ? (
          <AreaChart
            data={data.dailyVolume}
            xKey="date"
            lines={[{ key: "points", name: "Points Minted", color: "#10b981" }]}
            height={260}
          />
        ) : null}
      </div>

      {/* Top 20 Earners */}
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
        <h3 className="text-base font-semibold text-white mb-1">Top 20 Earners</h3>
        <p className="text-xs text-gray-400 mb-4">Addresses with the highest total points from completed queue jobs</p>
        {loading ? (
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="animate-pulse h-10 bg-gray-700 rounded-xl" />
            ))}
          </div>
        ) : data?.top20Earners ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left pb-3 w-12 font-medium">Rank</th>
                  <th className="text-left pb-3 font-medium">Address</th>
                  <th className="text-right pb-3 font-medium">Total Points</th>
                  <th className="text-right pb-3 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.top20Earners.map((earner) => {
                  const pct = totalMinted > 0 ? ((earner.totalPoints / totalMinted) * 100).toFixed(2) : "0";
                  return (
                    <tr
                      key={earner.address}
                      className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                    >
                      <td className="py-2.5">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                            earner.rank <= 3
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-gray-700 text-gray-400"
                          }`}
                        >
                          #{earner.rank}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <a
                          href={`https://celoscan.io/address/${earner.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-gray-300 hover:text-emerald-400 transition-colors"
                        >
                          {earner.shortAddress}
                        </a>
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-emerald-400">
                        {earner.totalPoints.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-700 rounded-full h-1.5">
                            <div
                              className="h-1.5 bg-indigo-500 rounded-full"
                              style={{ width: `${Math.min(100, parseFloat(pct) * 10)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-10 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </PageWrapper>
  );
}
