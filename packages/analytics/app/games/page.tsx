"use client";

import { useCallback, useEffect, useState } from "react";
import PageWrapper from "@/components/PageWrapper";
import StatCard from "@/components/StatCard";
import AreaChart from "@/components/charts/AreaChart";
import BarChart from "@/components/charts/BarChart";

interface GamesData {
  streakStats: {
    totalClaims: number;
    uniqueUsers: number;
    totalPoints: number;
  };
  sevenDayStats: {
    totalClaims: number;
    uniqueUsers: number;
    totalPoints: number;
  };
  gameStreakStats: {
    totalClaims: number;
    uniqueUsers: number;
    totalPoints: number;
  };
  passStats: {
    completedBurns: number;
    completedRefunds: number;
    uniqueAddresses: number;
    burnedPoints: number;
    refundedPoints: number;
  };
  raffleStats: {
    entryCount: number;
    uniqueUsers: number;
  };
  streakTrend: { date: string; claims: number }[];
  streakBreakdown: {
    name: string;
    claims: number;
    uniqueUsers: number;
    totalPoints: number;
  }[];
  barData: { name: string; claims: number; points: number }[];
  activitySummary: {
    category: string;
    totalClaims: number;
    uniqueUsers: number;
    totalPoints: number;
    color: string;
  }[];
}

export default function GamesPage() {
  const [data, setData] = useState<GamesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const secret = sessionStorage.getItem("analytics_secret") ?? "";
      const res = await fetch(`/api/games?secret=${encodeURIComponent(secret)}`);
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

  return (
    <PageWrapper
      title="Games & Passes"
      subtitle="Streak rewards, passport operations, and physical raffle participation"
      onRefresh={fetchData}
      lastUpdated={lastUpdated}
      loading={loading}
    >
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
          Error: {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Streak Reward Claims"
          value={data?.streakStats.totalClaims ?? 0}
          subtitle={`${data?.streakStats.uniqueUsers ?? 0} unique users`}
          icon="🔥"
          accent="amber"
          loading={loading}
        />
        <StatCard
          title="7-Day Streak Claims"
          value={data?.sevenDayStats.totalClaims ?? 0}
          subtitle={`${data?.sevenDayStats.uniqueUsers ?? 0} unique users`}
          icon="🗓️"
          accent="indigo"
          loading={loading}
        />
        <StatCard
          title="Passport Burns"
          value={data?.passStats.completedBurns ?? 0}
          subtitle={`${data?.passStats.uniqueAddresses ?? 0} unique addresses`}
          icon="🎫"
          accent="green"
          loading={loading}
        />
        <StatCard
          title="Physical Raffle Entries"
          value={data?.raffleStats.entryCount ?? 0}
          subtitle={`${data?.raffleStats.uniqueUsers ?? 0} unique users`}
          icon="🎰"
          accent="blue"
          loading={loading}
        />
      </div>

      {/* Activity summary cards */}
      {!loading && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {data.activitySummary.map((activity) => (
            <div
              key={activity.category}
              className="bg-gray-800 rounded-2xl border border-gray-700 p-5"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">{activity.category}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {activity.uniqueUsers.toLocaleString()} unique users
                  </p>
                </div>
                <div
                  className="w-3 h-3 rounded-full mt-1.5"
                  style={{ backgroundColor: activity.color }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900/60 rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-1">Total Claims</div>
                  <div
                    className="text-xl font-bold"
                    style={{ color: activity.color }}
                  >
                    {activity.totalClaims.toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-900/60 rounded-xl p-3">
                  <div className="text-xs text-gray-500 mb-1">Total Points</div>
                  <div className="text-xl font-bold text-emerald-400">
                    {activity.totalPoints.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Streak claim trend */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Streak Rewards Trend</h3>
          <p className="text-xs text-gray-400 mb-4">All streak reward claims in the last 14 days</p>
          {loading ? (
            <div className="h-56 animate-pulse bg-gray-700 rounded-xl" />
          ) : data?.streakTrend ? (
            <AreaChart
              data={data.streakTrend}
              xKey="date"
              lines={[{ key: "claims", name: "Streak Claims", color: "#f59e0b" }]}
              height={220}
            />
          ) : null}
        </div>

        {/* All-time activity bar */}
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Activity Comparison</h3>
          <p className="text-xs text-gray-400 mb-4">Recorded activity by supported category</p>
          {loading ? (
            <div className="h-56 animate-pulse bg-gray-700 rounded-xl" />
          ) : data?.barData ? (
            <BarChart
              data={data.barData}
              xKey="name"
              bars={[
                { key: "claims", name: "Claims", color: "#6366f1" },
              ]}
              height={220}
            />
          ) : null}
        </div>
      </div>

      {!loading && data?.streakBreakdown?.length ? (
        <div className="mt-6 bg-gray-800 rounded-2xl border border-gray-700 p-6">
          <h3 className="text-base font-semibold text-white mb-1">Streak Breakdown</h3>
          <p className="text-xs text-gray-400 mb-4">Claims by tracked streak reward type</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left pb-3 font-medium">Streak</th>
                  <th className="text-right pb-3 font-medium">Claims</th>
                  <th className="text-right pb-3 font-medium">Unique Users</th>
                  <th className="text-right pb-3 font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.streakBreakdown.map((row) => (
                  <tr key={row.name} className="border-b border-gray-700/50">
                    <td className="py-2.5 text-gray-200">{row.name}</td>
                    <td className="py-2.5 text-right text-gray-300">{row.claims.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-gray-300">{row.uniqueUsers.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-emerald-400">{row.totalPoints.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Contract info */}
      <div className="mt-6 bg-gray-800 rounded-2xl border border-gray-700 p-6">
        <h3 className="text-base font-semibold text-white mb-4">Contract References</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {[
            {
              name: "AkibaRaffle",
              address: "0xD75dfa972C6136f1c594Fec1945302f885E1ab29",
            },
            {
              name: "Games Contract",
              address: "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a",
            },
            {
              name: "SuperChain / Prosperity Pass",
              address: "0x58f5805b5072C3Dd157805132714E1dF40E79c66",
            },
          ].map((contract) => (
            <div key={contract.name} className="bg-gray-900/60 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">{contract.name}</div>
              <a
                href={`https://celoscan.io/address/${contract.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-emerald-400 hover:text-emerald-300 transition-colors break-all"
              >
                {contract.address}
              </a>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
          <p className="text-xs text-indigo-300">
            Note: This page only includes streak rewards, passport ops, and physical raffle rows
            that the app stores directly. It does not reconstruct all token-raffle or raw gameplay
            events from subgraphs.
            For full chain event history use{" "}
            <a
              href="https://celoscan.io"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-indigo-200"
            >
              Celoscan
            </a>
            .
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}
