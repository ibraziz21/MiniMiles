"use client";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";
import { Table } from "@/components/ui/Table";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

interface QuestsData {
  questRates: { questId: string; count: number; points: number }[];
  dailyTrend: { date: string; count: number }[];
  streakHealth: { questId: string; avgStreak: number; maxStreak: number; activeUsers: number }[];
  mintByReason: { reason: string; completed: number; pending: number; points: number }[];
  pendingMintJobs: {
    rows: { user_address: string; points: number; reason: string; created_at: string }[];
    total: number;
  };
}

const PALETTE = ["#0D7A8A", "#14B8A6", "#22D3EE", "#0891b2", "#0e7490", "#67E8F9", "#a5f3fc"];

function StreakMeter({ avg, max }: { avg: number; max: number }) {
  const pct = max > 0 ? Math.min((avg / max) * 100, 100) : 0;
  return (
    <div className="mt-0.5">
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full bg-[#0D7A8A] rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function QuestsPage() {
  const [data, setData] = useState<QuestsData | null>(null);

  useEffect(() => {
    fetch("/api/quests").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-gray-500 text-sm p-2">Loading…</div>;

  const totalPending = data.pendingMintJobs.total;
  const totalPendingMiles = data.mintByReason.reduce((s, m) => s + m.pending * (m.points / Math.max(m.completed + m.pending, 1)), 0);

  const pendingRows = data.pendingMintJobs.rows.map((r) => [
    `${r.user_address.slice(0, 8)}…`,
    r.points.toLocaleString(),
    r.reason,
    r.created_at.slice(0, 16).replace("T", " "),
  ]);

  const mintRows = data.mintByReason.map((m) => {
    const pendingRate = m.completed + m.pending > 0
      ? ((m.pending / (m.completed + m.pending)) * 100).toFixed(0)
      : "0";
    return [m.reason, m.completed.toLocaleString(), m.pending.toLocaleString(), `${pendingRate}%`, m.points.toLocaleString()];
  });

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold text-white">Earn · Daily quests → Miles minted</h1>
        <p className="text-xs text-gray-500 mt-1">
          How users complete daily tasks, build streaks, and convert engagement into minted miles.
        </p>
      </div>

      {/* Journey steps */}
      <div className="flex flex-wrap gap-2">
        {[
          { step: "1", label: "Complete quest", note: "daily_engagements row written, points_awarded set" },
          { step: "2", label: "Streak tracked", note: "streaks table increments current_streak" },
          { step: "3", label: "Mint job queued", note: "minipoint_mint_jobs row created (status: pending)" },
          { step: "4", label: "Miles minted on-chain", note: "job processor calls AkibaMilesV2.mint(), status → completed" },
        ].map(({ step, label, note }) => (
          <div key={step} className="flex items-center gap-2 bg-[#13161F] border border-white/5 rounded-lg px-3 py-2">
            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 rounded px-1.5 py-0.5">{step}</span>
            <div>
              <p className="text-xs font-medium text-white">{label}</p>
              <p className="text-[10px] text-gray-600">{note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pending queue health alert */}
      {totalPending > 0 && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${totalPending > 50 ? "border-amber-400/30 bg-amber-400/5" : "border-white/5 bg-white/[0.02]"}`}>
          <span className={`text-lg mt-0.5 ${totalPending > 50 ? "text-amber-400" : "text-gray-500"}`}>⏳</span>
          <div>
            <p className="text-sm font-medium text-white">{totalPending} pending mint {totalPending === 1 ? "job" : "jobs"}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Miles are queued but not yet on-chain. {totalPending > 50 ? "Queue is large — check the mint processor." : "Normal processing lag."}
            </p>
          </div>
        </div>
      )}

      {/* Trend + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Daily completions (14d)" sub="Total quest claims per day — measures daily engagement depth">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.dailyTrend}>
              <defs>
                <linearGradient id="questGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0D7A8A" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0D7A8A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(d) => d.slice(5)} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} />
              <Area type="monotone" dataKey="count" name="Completions" stroke="#0D7A8A" fill="url(#questGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Miles distributed by source (30d)" sub="Where miles come from — concentration in one source is fragile">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.mintByReason.slice(0, 8)} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
              <YAxis dataKey="reason" type="category" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={96} />
              <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} formatter={(v: number) => [v.toLocaleString(), "Miles"]} />
              <Bar dataKey="points" name="Miles" radius={[0, 2, 2, 0]}>
                {data.mintByReason.slice(0, 8).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* Streak health */}
      <Section title="Streak health per quest" sub="Avg streak vs max streak — low avg/max ratio means most users break early">
        <div className="mt-1 space-y-3">
          {data.streakHealth.length === 0 && <p className="text-xs text-gray-600">No streak data</p>}
          {data.streakHealth.map((s) => (
            <div key={s.questId} className="grid grid-cols-4 gap-4 items-center">
              <span className="text-xs text-gray-400 truncate col-span-1">{s.questId}</span>
              <div className="col-span-2">
                <StreakMeter avg={s.avgStreak} max={s.maxStreak} />
              </div>
              <div className="flex gap-3 justify-end text-[10px] font-mono text-gray-500 whitespace-nowrap">
                <span>avg <span className="text-white">{s.avgStreak}</span></span>
                <span>max <span className="text-white">{s.maxStreak}</span></span>
                <span className="text-gray-600">{s.activeUsers} users</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Mint pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Mint job pipeline by source" sub="Pending % tells you which sources have backlogged rewards">
          <Table
            headers={["Source", "Done", "Pending", "Backlog %", "Miles"]}
            rows={mintRows}
          />
        </Section>

        <Section title={`Pending queue — next ${data.pendingMintJobs.rows.length} jobs`} sub="Oldest jobs shown first — stale entries indicate processor failure">
          <Table headers={["Wallet", "Points", "Reason", "Queued at"]} rows={pendingRows} />
        </Section>
      </div>
    </div>
  );
}
