"use client";

import { useState } from "react";
import { Trophy, Medal, Copy, CheckCircle, Warning } from "@phosphor-icons/react";

type PayoutEntry = {
  rank: number;
  walletAddress: string;
  username: string | null;
  score: number;
  prizeUsd: number;
};

type Snapshot = {
  week: string;
  range: { from: string; to: string };
  payouts: Record<string, PayoutEntry[]>;
  totalUsd: number;
};

const GAME_LABELS: Record<string, string> = {
  rule_tap: "Rule Tap",
  memory_flip: "Memory Flip",
};

const RANK_ICONS = [
  <Trophy key="1" size={14} weight="fill" className="text-yellow-500" />,
  <Medal key="2" size={14} weight="fill" className="text-slate-400" />,
  <Medal key="3" size={14} weight="fill" className="text-orange-400" />,
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" onClick={copy} className="ml-1 text-[#817E7E] hover:text-[#238D9D] transition-colors">
      {copied
        ? <CheckCircle size={13} weight="fill" className="text-green-500" />
        : <Copy size={13} />}
    </button>
  );
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function WeeklyPayoutsPage() {
  const [secret, setSecret]     = useState("");
  const [week, setWeek]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError]       = useState<string | null>(null);

  async function load() {
    if (!secret) { setError("Enter the admin secret"); return; }
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const params = new URLSearchParams({ secret });
      if (week) params.set("week", week);
      const res = await fetch(`/api/admin/weekly-payout-snapshot?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F7F7] px-4 py-8 font-sans">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Weekly Payout Snapshot</h1>
          <p className="text-sm text-[#817E7E] mt-0.5">Top 3 per game for the selected ISO week</p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 space-y-3 shadow-sm">
          <div>
            <label className="text-xs font-semibold text-[#525252] block mb-1">Admin secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="ADMIN_QUEUE_SECRET"
              className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm outline-none focus:border-[#238D9D]"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#525252] block mb-1">
              ISO week <span className="font-normal text-[#817E7E]">(leave blank for current week)</span>
            </label>
            <input
              type="text"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              placeholder="e.g. 2025-W16"
              className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm outline-none focus:border-[#238D9D]"
            />
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="w-full rounded-xl bg-[#238D9D] text-white text-sm font-semibold py-2.5 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load snapshot"}
          </button>
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <Warning size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Results */}
        {snapshot && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-[#1A1A1A]">Week {snapshot.week}</p>
              <span className="text-xs bg-[#238D9D1A] text-[#238D9D] font-semibold rounded-full px-2.5 py-1">
                Total: ${snapshot.totalUsd}
              </span>
            </div>
            <p className="text-xs text-[#817E7E]">
              {new Date(snapshot.range.from).toUTCString()} → {new Date(snapshot.range.to).toUTCString()}
            </p>

            {Object.entries(snapshot.payouts).map(([gameType, entries]) => (
              <div key={gameType} className="bg-white rounded-2xl border border-[#F0F0F0] shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-[#F5F5F5]">
                  <p className="text-sm font-bold text-[#1A1A1A]">{GAME_LABELS[gameType] ?? gameType}</p>
                </div>
                {entries.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-[#817E7E]">No entries this week</p>
                ) : (
                  <div className="divide-y divide-[#F5F5F5]">
                    {entries.map((entry) => (
                      <div key={entry.walletAddress} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F5F5]">
                          {RANK_ICONS[entry.rank - 1]}
                        </div>
                        <div className="flex-1 min-w-0">
                          {entry.username && (
                            <p className="text-sm font-semibold text-[#1A1A1A]">@{entry.username}</p>
                          )}
                          <div className="flex items-center">
                            <p className="text-xs text-[#817E7E] font-mono">{shortAddress(entry.walletAddress)}</p>
                            <CopyButton text={entry.walletAddress} />
                          </div>
                          <p className="text-xs text-[#525252]">{entry.score} pts</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-base font-bold text-[#238D9D]">${entry.prizeUsd}</p>
                          <p className="text-[10px] text-[#817E7E]">USDT</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Copy-all for quick sending */}
            <div className="bg-white rounded-2xl border border-[#F0F0F0] shadow-sm p-4">
              <p className="text-xs font-semibold text-[#525252] mb-2">All wallets (copy to send)</p>
              <div className="space-y-1.5">
                {Object.entries(snapshot.payouts).flatMap(([gameType, entries]) =>
                  entries.map((entry) => (
                    <div key={`${gameType}-${entry.walletAddress}`} className="flex items-center justify-between bg-[#F7F7F7] rounded-lg px-3 py-1.5">
                      <span className="text-xs font-mono text-[#1A1A1A]">{entry.walletAddress}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[#238D9D]">${entry.prizeUsd}</span>
                        <CopyButton text={entry.walletAddress} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
