"use client";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";
import { Table } from "@/components/ui/Table";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

interface UsersData {
  registrationTrend: { date: string; count: number }[];
  topEarners: { rank: number; wallet: string; username: string; miles: number }[];
  profileBuckets: { range: string; count: number }[];
  milesByDay: { date: string; miles: number }[];
}

const BUCKET_COLORS = ["#ef4444", "#f59e0b", "#14B8A6", "#0D7A8A"];

function Funnel({ buckets }: { buckets: { range: string; count: number }[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return <div className="text-xs text-gray-600 py-4">No data</div>;
  return (
    <div className="space-y-2 mt-2">
      {buckets.map((b, i) => {
        const pct = total > 0 ? (b.count / total) * 100 : 0;
        const labels = ["Bare (0–25%)", "Partial (26–50%)", "Mostly done (51–75%)", "Complete (76–100%)"];
        const colors = BUCKET_COLORS;
        return (
          <div key={b.range}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">{labels[i] ?? b.range}</span>
              <span className="font-mono text-gray-300">{b.count.toLocaleString()} <span className="text-gray-600">({pct.toFixed(0)}%)</span></span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: colors[i] }} />
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-gray-600 pt-1">
        Profile completion measures: username, email, phone, Twitter, avatar, bio, country.
        Users with bare profiles are unlikely to return.
      </p>
    </div>
  );
}

export default function UsersPage() {
  const [data, setData] = useState<UsersData | null>(null);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-gray-500 text-sm p-2">Loading…</div>;

  const earnerRows = data.topEarners.map((e) => [
    `#${e.rank}`,
    e.username || `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`,
    e.miles.toLocaleString(),
  ]);

  const totalUsers = data.profileBuckets.reduce((s, b) => s + b.count, 0);
  const completeUsers = data.profileBuckets.find(b => b.range === "76-100")?.count ?? 0;
  const completionRate = totalUsers > 0 ? ((completeUsers / totalUsers) * 100).toFixed(0) : "—";

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold text-white">Users · Sign up → Earn miles</h1>
        <p className="text-xs text-gray-500 mt-1">
          How users enter the platform, complete their profile, and start accumulating miles.
        </p>
      </div>

      {/* Journey steps as an inline callout row */}
      <div className="flex flex-wrap gap-2">
        {[
          { step: "1", label: "Register", note: "new-user-signup mint job fires" },
          { step: "2", label: "Complete profile", note: "username, email, avatar, etc." },
          { step: "3", label: "Earn first miles", note: "quest, game, or referral" },
          { step: "4", label: "Return daily", note: "DAU, streaks" },
        ].map(({ step, label, note }) => (
          <div key={step} className="flex items-center gap-2 bg-[#13161F] border border-white/5 rounded-lg px-3 py-2">
            <span className="text-[10px] font-bold text-[#0D7A8A] bg-[#0D7A8A]/10 rounded px-1.5 py-0.5">{step}</span>
            <div>
              <p className="text-xs font-medium text-white">{label}</p>
              <p className="text-[10px] text-gray-600">{note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Registration trend + miles velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="New registrations (30d)" sub="Each bar = one signup event via new-user-signup mint job">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.registrationTrend}>
              <defs>
                <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0D7A8A" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0D7A8A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(d) => d.slice(5)} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} labelFormatter={(d) => d} />
              <Area type="monotone" dataKey="count" name="Signups" stroke="#0D7A8A" fill="url(#regGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Miles earned per day (30d)" sub="Measures how effectively the platform converts engagement to rewards">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.milesByDay}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(d) => d.slice(5)} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }} formatter={(v: number) => [v.toLocaleString(), "Miles"]} />
              <Bar dataKey="miles" fill="#0D7A8A" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* Profile completion funnel + top earners */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Profile completion funnel"
          sub={`${completionRate}% of users have fully completed profiles — incomplete profiles correlate with churn`}
        >
          <Funnel buckets={data.profileBuckets} />
        </Section>

        <Section title="Top earners (lifetime)" sub="These power users anchor ecosystem health — watch for concentration risk">
          <Table headers={["Rank", "User", "Miles"]} rows={earnerRows} />
        </Section>
      </div>
    </div>
  );
}
