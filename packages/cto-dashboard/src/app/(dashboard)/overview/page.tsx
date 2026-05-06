"use client";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";

interface OverviewData {
  totalUsers: number;
  dau: number;
  totalMilesDB: number;
  newUsersLast30d: number;
  milesSupply: number;
  vaultTVL: number;
  treasuryPool: number;
  todayGames: { total: number; accepted: number; rejected: number; milesAwarded: number };
  diceStats: { totalCreated: number; totalResolved: number; totalPayoutMiles: number };
}

function StatRow({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-mono font-semibold ${highlight ? "text-[#0D7A8A]" : "text-white"}`}>{value}</span>
        {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function JourneyCard({ title, step, color, stats, health }: {
  title: string;
  step: string;
  color: string;
  stats: { label: string; value: string; highlight?: boolean }[];
  health: "good" | "warn" | "dead";
}) {
  const dot = { good: "bg-emerald-500", warn: "bg-amber-400", dead: "bg-red-500" }[health];
  return (
    <div className="bg-[#13161F] border border-white/5 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">{step}</p>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${dot}`} title={health} />
      </div>
      <div className="divide-y divide-white/5">
        {stats.map((s) => (
          <div key={s.label} className="flex justify-between items-center py-2 first:pt-0 last:pb-0">
            <span className="text-xs text-gray-500">{s.label}</span>
            <span className={`text-xs font-mono font-medium ${s.highlight ? "text-[#0D7A8A]" : "text-gray-200"}`}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    fetch("/api/overview").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-gray-500 text-sm p-2">Loading…</div>;

  const acceptRate = data.todayGames.total > 0
    ? (data.todayGames.accepted / data.todayGames.total) * 100
    : null;

  const diceResolutionRate = data.diceStats.totalCreated > 0
    ? (data.diceStats.totalResolved / data.diceStats.totalCreated) * 100
    : null;

  const supplyVsDB = data.milesSupply > 0 && data.totalMilesDB > 0
    ? ((data.milesSupply / data.totalMilesDB) * 100).toFixed(1)
    : null;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold text-white">Platform Overview</h1>
        <p className="text-xs text-gray-500 mt-1">Live health across all four user journeys</p>
      </div>

      {/* Top-line pulse */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-white/5 rounded-xl overflow-hidden border border-white/5">
        {[
          { label: "Total Users", value: data.totalUsers.toLocaleString() },
          { label: "Active Today", value: data.dau.toLocaleString(), hi: true },
          { label: "New (30d)", value: data.newUsersLast30d.toLocaleString() },
          { label: "Miles Supply", value: `${(data.milesSupply / 1_000_000).toFixed(2)}M` },
          { label: "Vault TVL", value: `$${data.vaultTVL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, hi: true },
          { label: "Treasury", value: `${(data.treasuryPool / 1_000).toFixed(1)}K mi` },
        ].map(({ label, value, hi }) => (
          <div key={label} className="bg-[#13161F] px-4 py-4 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
            <span className={`text-lg font-mono font-bold ${hi ? "text-[#0D7A8A]" : "text-white"}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Journey health cards */}
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gray-600 mb-3">User Journeys</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <JourneyCard
            step="Journey 1"
            title="Sign up → Earn miles"
            color="#0D7A8A"
            health={data.newUsersLast30d > 0 ? "good" : "warn"}
            stats={[
              { label: "Total registered", value: data.totalUsers.toLocaleString() },
              { label: "Joined last 30d", value: data.newUsersLast30d.toLocaleString(), highlight: true },
              { label: "Miles minted (DB)", value: `${(data.totalMilesDB / 1_000_000).toFixed(2)}M` },
              { label: "On-chain supply", value: `${(data.milesSupply / 1_000_000).toFixed(2)}M` },
              { label: "DB→chain sync", value: supplyVsDB ? `${supplyVsDB}%` : "—" },
            ]}
          />
          <JourneyCard
            step="Journey 2"
            title="Play skill games → Win miles"
            color="#7c3aed"
            health={acceptRate !== null ? (acceptRate > 70 ? "good" : acceptRate > 40 ? "warn" : "dead") : "warn"}
            stats={[
              { label: "Sessions today", value: data.todayGames.total.toString() },
              { label: "Accepted today", value: data.todayGames.accepted.toString(), highlight: true },
              { label: "Accept rate", value: acceptRate !== null ? `${acceptRate.toFixed(1)}%` : "—" },
              { label: "Miles awarded today", value: `${(data.todayGames.milesAwarded / 1_000).toFixed(1)}K` },
              { label: "Treasury pool", value: `${(data.treasuryPool / 1_000).toFixed(1)}K mi` },
            ]}
          />
          <JourneyCard
            step="Journey 3"
            title="Roll dice → Earn payout"
            color="#f59e0b"
            health={diceResolutionRate !== null ? (diceResolutionRate > 90 ? "good" : diceResolutionRate > 60 ? "warn" : "dead") : "warn"}
            stats={[
              { label: "Rounds created", value: data.diceStats.totalCreated.toLocaleString() },
              { label: "Rounds resolved", value: data.diceStats.totalResolved.toLocaleString(), highlight: true },
              { label: "Resolution rate", value: diceResolutionRate !== null ? `${diceResolutionRate.toFixed(1)}%` : "—" },
              { label: "Total payout", value: `${(data.diceStats.totalPayoutMiles / 1_000).toFixed(1)}K mi` },
              { label: "Unresolved", value: (data.diceStats.totalCreated - data.diceStats.totalResolved).toLocaleString() },
            ]}
          />
          <JourneyCard
            step="Journey 4"
            title="Deposit USDT → Earn yield"
            color="#10b981"
            health={data.vaultTVL > 0 ? "good" : "warn"}
            stats={[
              { label: "TVL (on-chain)", value: `$${data.vaultTVL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, highlight: true },
              { label: "Active today", value: data.dau.toLocaleString() },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
