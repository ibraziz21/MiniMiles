"use client";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";
import { Table } from "@/components/ui/Table";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, ReferenceLine,
} from "recharts";

interface GamesData {
  sessionVolume: { date: string; rule_tap: number; memory_flip: number; rejected: number }[];
  scoreDistribution: {
    rule_tap: { score: number; count: number }[];
    memory_flip: { score: number; count: number }[];
  };
  antiFlagRates: { flag: string; count: number }[];
  leaderboards: {
    rule_tap: { rank: number; wallet: string; username: string; score: number; rewardMiles: number }[];
    memory_flip: { rank: number; wallet: string; username: string; score: number; rewardMiles: number }[];
  };
  today: { total: number; accepted: number; rejected: number; milesAwarded: number };
  dice: { totalCreated: number; totalResolved: number; totalPayoutMiles: number };
  treasuryPool: number;
}

function AcceptBar({ accepted, rejected }: { accepted: number; rejected: number }) {
  const total = accepted + rejected;
  if (total === 0) return <div className="text-xs text-gray-600">No sessions today</div>;
  const pct = (accepted / total) * 100;
  const health = pct > 80 ? "bg-emerald-500" : pct > 50 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-gray-400">Accepted <span className="text-white font-mono">{accepted}</span></span>
        <span className="text-gray-400">Rejected <span className="text-white font-mono">{rejected}</span></span>
      </div>
      <div className="h-2.5 bg-white/5 rounded-full overflow-hidden flex">
        <div className={`h-full ${health} transition-all`} style={{ width: `${pct}%` }} />
        <div className="h-full bg-red-900/40 flex-1" />
      </div>
      <p className="text-[10px] text-gray-600 mt-1.5">
        {pct.toFixed(1)}% accept rate today — a drop below 60% signals replay validation or anti-abuse issues.
      </p>
    </div>
  );
}

export default function GamesPage() {
  const [data, setData] = useState<GamesData | null>(null);
  const [lbTab, setLbTab] = useState<"rule_tap" | "memory_flip">("rule_tap");

  useEffect(() => {
    fetch("/api/games").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-gray-500 text-sm p-2">Loading…</div>;

  const unresolved = data.dice.totalCreated - data.dice.totalResolved;
  const lb = data.leaderboards[lbTab];
  const lbRows = lb.map((r) => [
    `#${r.rank}`,
    r.username || `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`,
    r.score.toLocaleString(),
    r.rewardMiles.toLocaleString(),
  ]);
  const flagRows = data.antiFlagRates.slice(0, 10).map((f) => [f.flag, f.count.toLocaleString()]);

  const totalFlags = data.antiFlagRates.reduce((s, f) => s + f.count, 0);
  const totalSessions30d = data.sessionVolume.reduce((s, d) => s + d.rule_tap + d.memory_flip + d.rejected, 0);
  const flagRate = totalSessions30d > 0 ? ((totalFlags / totalSessions30d) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold text-white">Games · Play → Win miles</h1>
        <p className="text-xs text-gray-500 mt-1">
          Skill game funnel: session created → replay validated → settlement signed → miles awarded on-chain.
        </p>
      </div>

      {/* Journey steps */}
      <div className="flex flex-wrap gap-2">
        {[
          { step: "1", label: "Start session", note: "AkibaSkillGames.startGame() on-chain, GameStarted event" },
          { step: "2", label: "Play & submit replay", note: "Client sends action log to /api/games/verify" },
          { step: "3", label: "Replay validation", note: "Server re-simulates vs seeded RNG + anti-abuse checks" },
          { step: "4", label: "ECDSA settlement", note: "Verifier signs digest, client calls settleGame()" },
          { step: "5", label: "Miles awarded", note: "GameTreasury mints reward to player wallet" },
        ].map(({ step, label, note }) => (
          <div key={step} className="flex items-center gap-2 bg-[#13161F] border border-white/5 rounded-lg px-3 py-2">
            <span className="text-[10px] font-bold text-purple-400 bg-purple-400/10 rounded px-1.5 py-0.5">{step}</span>
            <div>
              <p className="text-xs font-medium text-white">{label}</p>
              <p className="text-[10px] text-gray-600">{note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Today's funnel health + treasury */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="Today's session funnel" sub="Real-time accept/reject split">
          <AcceptBar accepted={data.today.accepted} rejected={data.today.rejected} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="bg-white/[0.03] rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Miles awarded</p>
              <p className="text-base font-mono font-bold text-white">{(data.today.milesAwarded / 1_000).toFixed(1)}K</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Treasury pool</p>
              <p className="text-base font-mono font-bold text-[#0D7A8A]">{(data.treasuryPool / 1_000).toFixed(1)}K mi</p>
            </div>
          </div>
        </Section>

        <Section title="Anti-abuse flag rate (30d)" sub={`${flagRate}% of sessions flagged — above 10% needs investigation`}>
          <Table headers={["Flag", "Count"]} rows={flagRows} />
        </Section>

        <Section title="Dice rounds (on-chain lifetime)" sub="Unresolved rounds = potential stuck VRF requests">
          <div className="space-y-3 mt-1">
            {[
              { label: "Rounds created", value: data.dice.totalCreated.toLocaleString() },
              { label: "Rounds resolved", value: data.dice.totalResolved.toLocaleString(), hi: true },
              { label: "Unresolved", value: unresolved.toLocaleString(), warn: unresolved > 100 },
              { label: "Total payout", value: `${(data.dice.totalPayoutMiles / 1_000).toFixed(1)}K mi` },
            ].map(({ label, value, hi, warn }) => (
              <div key={label} className="flex justify-between text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                <span className="text-gray-500">{label}</span>
                <span className={`font-mono font-medium ${warn ? "text-amber-400" : hi ? "text-[#0D7A8A]" : "text-gray-200"}`}>{value}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Volume over time */}
      <Section title="Skill game sessions (30d)" sub="Rule Tap vs Memory Flip volume — rejected sessions shown to surface abuse spikes">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.sessionVolume}>
            <defs>
              <linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0D7A8A" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#0D7A8A" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="mfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(d) => d.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v) => v === "rule_tap" ? "Rule Tap" : v === "memory_flip" ? "Memory Flip" : "Rejected"} />
            <Area type="monotone" dataKey="rule_tap" stroke="#0D7A8A" fill="url(#rtGrad)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="memory_flip" stroke="#7c3aed" fill="url(#mfGrad)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="rejected" stroke="#ef4444" fill="none" strokeWidth={1} strokeDasharray="3 3" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* Score distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Rule Tap — score distribution" sub="Healthy bell curve means fair difficulty. Left-skew = too hard. Right-skew = trivial or cheated.">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data.scoreDistribution.rule_tap}>
              <XAxis dataKey="score" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} />
              <Bar dataKey="count" name="Sessions" fill="#0D7A8A" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Memory Flip — score distribution" sub="Scores cluster near max suggest memory or replay cheating attempts.">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data.scoreDistribution.memory_flip}>
              <XAxis dataKey="score" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} />
              <Bar dataKey="count" name="Sessions" fill="#7c3aed" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* Leaderboard */}
      <Section title="Leaderboard — top scores" sub="High scores from verified sessions only (accepted = true)">
        <div className="flex gap-2 mb-3">
          {(["rule_tap", "memory_flip"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setLbTab(g)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                lbTab === g ? "bg-[#0D7A8A] text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {g === "rule_tap" ? "Rule Tap" : "Memory Flip"}
            </button>
          ))}
        </div>
        <Table headers={["Rank", "User", "Score", "Miles won"]} rows={lbRows} />
      </Section>
    </div>
  );
}
