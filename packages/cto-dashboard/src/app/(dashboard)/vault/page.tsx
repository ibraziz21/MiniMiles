"use client";
import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";
import { Table } from "@/components/ui/Table";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

interface VaultData {
  tvlDB: number;
  tvlOnchain: number;
  tvlTrend: { date: string; netFlow: number }[];
  topDepositors: { rank: number; wallet: string; username: string; balanceUsdt: number; updatedAt: string }[];
  flowBreakdown: { deposits: number; withdrawals: number; netFlow: number; txDeposits: number; txWithdrawals: number };
}

function DeltaBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded ${pos ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
      {pos ? "+" : ""}{value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
}

export default function VaultPage() {
  const [data, setData] = useState<VaultData | null>(null);

  useEffect(() => {
    fetch("/api/vault").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-gray-500 text-sm p-2">Loading…</div>;

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const onchainVsDB = data.tvlDB > 0
    ? ((data.tvlOnchain / data.tvlDB) * 100).toFixed(1)
    : null;

  const depositorRows = data.topDepositors.map((d) => [
    `#${d.rank}`,
    d.username || `${d.wallet.slice(0, 6)}…${d.wallet.slice(-4)}`,
    `$${d.balanceUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    d.updatedAt.slice(0, 10),
  ]);

  const top5Share = data.topDepositors.slice(0, 5).reduce((s, d) => s + d.balanceUsdt, 0);
  const top5Pct = data.tvlOnchain > 0 ? ((top5Share / data.tvlOnchain) * 100).toFixed(0) : "—";

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold text-white">Vault · Deposit USDT → Earn yield</h1>
        <p className="text-xs text-gray-500 mt-1">
          Capital flow health: how much is locked, who owns it, and whether deposits are growing.
        </p>
      </div>

      {/* Journey steps */}
      <div className="flex flex-wrap gap-2">
        {[
          { step: "1", label: "Approve USDT", note: "ERC-20 approval to vault contract" },
          { step: "2", label: "Deposit", note: "AkibaVault.deposit() — USDT locked on Celo" },
          { step: "3", label: "Yield accrual", note: "totalAssets() increases over time" },
          { step: "4", label: "Withdraw", note: "vault_events row written, balance updated" },
        ].map(({ step, label, note }) => (
          <div key={step} className="flex items-center gap-2 bg-[#13161F] border border-white/5 rounded-lg px-3 py-2">
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 rounded px-1.5 py-0.5">{step}</span>
            <div>
              <p className="text-xs font-medium text-white">{label}</p>
              <p className="text-[10px] text-gray-600">{note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* TVL health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="TVL snapshot" sub="On-chain is source of truth — DB drift signals a sync issue">
          <div className="space-y-3 mt-1">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">On-chain (totalAssets)</span>
              <span className="text-sm font-mono font-bold text-[#0D7A8A]">{fmt(data.tvlOnchain)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">DB (vault_positions sum)</span>
              <span className="text-sm font-mono font-bold text-white">{fmt(data.tvlDB)}</span>
            </div>
            {onchainVsDB && (
              <div className="flex justify-between items-center border-t border-white/5 pt-3">
                <span className="text-xs text-gray-500">Sync ratio</span>
                <span className={`text-xs font-mono ${Math.abs(parseFloat(onchainVsDB) - 100) < 2 ? "text-emerald-400" : "text-amber-400"}`}>
                  {onchainVsDB}%
                </span>
              </div>
            )}
          </div>
        </Section>

        <Section title="30d flow breakdown" sub="Net flow direction determines vault growth">
          <div className="space-y-3 mt-1">
            {[
              { label: "Deposits", value: fmt(data.flowBreakdown.deposits), txs: data.flowBreakdown.txDeposits, pos: true },
              { label: "Withdrawals", value: fmt(data.flowBreakdown.withdrawals), txs: data.flowBreakdown.txWithdrawals, pos: false },
            ].map(({ label, value, txs, pos }) => (
              <div key={label} className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-[10px] text-gray-600">{txs.toLocaleString()} transactions</p>
                </div>
                <span className={`text-sm font-mono font-semibold ${pos ? "text-emerald-400" : "text-red-400"}`}>{value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center border-t border-white/5 pt-3">
              <span className="text-xs text-gray-500">Net flow</span>
              <DeltaBadge value={data.flowBreakdown.netFlow} />
            </div>
          </div>
        </Section>

        <Section title="Concentration risk" sub="Top 5 depositors' share of total TVL">
          <div className="mt-2">
            <div className="text-3xl font-mono font-bold text-white mb-1">{top5Pct}%</div>
            <p className="text-xs text-gray-600">owned by top 5 depositors</p>
            <div className="mt-3 h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${parseFloat(top5Pct) > 80 ? "bg-red-500" : parseFloat(top5Pct) > 60 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(parseFloat(top5Pct) || 0, 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-2">
              High concentration means a single large withdrawal could significantly move TVL.
            </p>
          </div>
        </Section>
      </div>

      {/* Net flow chart */}
      <Section title="Daily net flow (30d)" sub="Positive = deposits exceeded withdrawals that day. Sustained negative = capital flight.">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.tvlTrend}>
            <defs>
              <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="negGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(d) => d.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "#1a1d27", border: "none", fontSize: 11 }}
              formatter={(v: number) => [`$${v.toLocaleString()}`, "Net Flow"]}
            />
            <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
            <Area type="monotone" dataKey="netFlow" stroke="#0D7A8A" fill="url(#posGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* Top depositors */}
      <Section title="Top depositors" sub="Sorted by current vault balance — these are your highest-value users">
        <Table headers={["Rank", "User", "Balance", "Last active"]} rows={depositorRows} />
      </Section>
    </div>
  );
}
