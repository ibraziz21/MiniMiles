"use client";

import { useCallback, useEffect, useState } from "react";
import PageWrapper from "@/components/PageWrapper";
import BarChart from "@/components/charts/BarChart";
import AreaChart from "@/components/charts/AreaChart";

interface QuestStat {
  name: string;
  totalClaims: number;
  uniqueUsers: number;
  totalPoints: number;
  last7dClaims: number;
}

interface QuestsData {
  questStats: QuestStat[];
  barData: { name: string; claims: number; points: number }[];
  dailyTrend: Record<string, unknown>[];
  top5Lines: { key: string; name: string; color: string }[];
  totalActiveUsers: number;
}

export default function QuestsPage() {
  const [data, setData] = useState<QuestsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<keyof QuestStat>("totalClaims");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const secret = sessionStorage.getItem("analytics_secret") ?? "";
      const res = await fetch(`/api/quests?secret=${encodeURIComponent(secret)}`);
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

  const sortedStats = data?.questStats
    ? [...data.questStats].sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (typeof aVal === "number" && typeof bVal === "number") return bVal - aVal;
        return String(bVal).localeCompare(String(aVal));
      })
    : [];

  return (
    <PageWrapper
      title="Quest Analytics"
      subtitle="Claim performance across daily and partner quests"
      onRefresh={fetchData}
      lastUpdated={lastUpdated}
      loading={loading}
    >
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          Error: {error}
        </div>
      )}

      {/* Summary stat */}
      {!loading && data && (
        <div className="mb-6 flex gap-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 px-5 py-3 flex items-center gap-3">
            <span className="text-xl">🎯</span>
            <div>
              <div className="text-xs text-gray-400">Total Active Users</div>
              <div className="text-lg font-bold text-emerald-400">{data.totalActiveUsers.toLocaleString()}</div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 px-5 py-3 flex items-center gap-3">
            <span className="text-xl">📊</span>
            <div>
              <div className="text-xs text-gray-400">Total All-Time Mints</div>
              <div className="text-lg font-bold text-indigo-400">
                {data.questStats.reduce((s, q) => s + q.totalClaims, 0).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 px-5 py-3 flex items-center gap-3">
            <span className="text-xl">🪙</span>
            <div>
              <div className="text-xs text-gray-400">Total Points Awarded</div>
              <div className="text-lg font-bold text-amber-400">
                {data.questStats.reduce((s, q) => s + q.totalPoints, 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quest Table */}
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">Quest Performance</h3>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            Sort by:
            {(["totalClaims", "uniqueUsers", "totalPoints", "last7dClaims"] as const).map((col) => (
              <button
                key={col}
                onClick={() => setSortBy(col)}
                className={`px-2 py-1 rounded-lg transition-colors ${
                  sortBy === col
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "hover:bg-gray-700 text-gray-400"
                }`}
              >
                {col === "totalClaims" ? "Claims" : col === "uniqueUsers" ? "Unique" : col === "totalPoints" ? "Points" : "7d Claims"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse h-12 bg-gray-700 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left pb-3 font-medium">Quest Name</th>
                  <th className="text-right pb-3 font-medium">Total Claims</th>
                  <th className="text-right pb-3 font-medium">Unique Users</th>
                  <th className="text-right pb-3 font-medium">Total Points</th>
                  <th className="text-right pb-3 font-medium">Last 7d Claims</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((quest, i) => (
                  <tr
                    key={quest.name}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-4">{i + 1}</span>
                        <span className="font-medium text-gray-200">{quest.name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right text-gray-300 font-mono">
                      {quest.totalClaims.toLocaleString()}
                    </td>
                    <td className="py-3 text-right text-gray-300 font-mono">
                      {quest.uniqueUsers.toLocaleString()}
                    </td>
                    <td className="py-3 text-right text-emerald-400 font-mono font-medium">
                      {quest.totalPoints.toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          quest.last7dClaims > 0
                            ? "bg-indigo-500/15 text-indigo-400"
                            : "bg-gray-700 text-gray-500"
                        }`}
                      >
                        {quest.last7dClaims.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart: last 30 days */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Quest Claims (All Time)</h3>
          <p className="text-xs text-gray-400 mb-4">Total claim counts per quest since launch</p>
          {loading ? (
            <div className="h-64 animate-pulse bg-gray-700 rounded-xl" />
          ) : data ? (
            <BarChart
              data={data.barData}
              xKey="name"
              bars={[{ key: "claims", name: "Claims", color: "#6366f1" }]}
              height={280}
            />
          ) : null}
        </div>

        {/* Line chart: daily trend top 5 */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Top 5 Quests — Daily Trend</h3>
          <p className="text-xs text-gray-400 mb-4">Daily claim counts for top 5 quests (last 14 days)</p>
          {loading ? (
            <div className="h-64 animate-pulse bg-gray-700 rounded-xl" />
          ) : data ? (
            <AreaChart
              data={data.dailyTrend}
              xKey="date"
              lines={data.top5Lines}
              height={280}
            />
          ) : null}
        </div>
      </div>
    </PageWrapper>
  );
}
