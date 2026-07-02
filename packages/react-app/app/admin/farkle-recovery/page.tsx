"use client";

import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  Copy,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";

type JobStatus =
  | "queued"
  | "leased"
  | "submitted"
  | "confirmed"
  | "retrying"
  | "failed"
  | "manual_review";

type RecoveryJob = {
  id: string;
  match_id: string;
  mode_key: string;
  winner_address: string;
  loser_address: string;
  winner_score: number;
  loser_score: number;
  win_miles: number;
  los_miles: number;
  win_credit_cents: number;
  chain_id: number;
  status: JobStatus;
  tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  leased_at: string | null;
  lease_owner: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
};

type MissingJob = {
  matchId: string;
  modeKey: string | null;
  winnerAddress: string | null;
  loserAddress: string | null;
  winnerScore: number | null;
  loserScore: number | null;
  completedAt: string | null;
  settledAt: string | null;
};

type Snapshot = {
  ok: boolean;
  counts: Record<string, number>;
  jobs: RecoveryJob[];
  missingJobs: MissingJob[];
  tableMissing?: boolean;
  generatedAt: string;
};

const DEFAULT_STATUS = "queued,retrying,leased,submitted,manual_review,failed";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  leased: "bg-blue-100 text-blue-700",
  submitted: "bg-indigo-100 text-indigo-700",
  confirmed: "bg-green-100 text-green-700",
  retrying: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  manual_review: "bg-red-100 text-red-700",
};

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex text-[#817E7E] hover:text-[#238D9D]"
      title="Copy"
    >
      {copied ? <CheckCircle size={13} weight="fill" className="text-green-500" /> : <Copy size={13} />}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export default function FarkleRecoveryPage() {
  const [secret, setSecret] = useState("");
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS);
  const [limit, setLimit] = useState(50);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const problemCount = useMemo(() => {
    if (!snapshot) return 0;
    return ["queued", "retrying", "leased", "submitted", "manual_review", "failed"]
      .reduce((sum, status) => sum + (snapshot.counts[status] ?? 0), 0);
  }, [snapshot]);

  async function load() {
    if (!secret) {
      setError("Enter the admin secret");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({ secret, status: statusFilter, limit: String(limit) });
      const res = await fetch(`/api/admin/farkle/recovery?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSnapshot(data as Snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery load failed");
    } finally {
      setLoading(false);
    }
  }

  async function runAction(body: Record<string, unknown>, label: string) {
    if (!secret) {
      setError("Enter the admin secret");
      return;
    }
    setActioning(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/farkle/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, secret }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setNotice(`${label} completed`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setActioning(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F7F7] px-4 py-8 font-sans">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Farkle Recovery</h1>
          <p className="mt-0.5 text-sm text-[#817E7E]">
            Review stuck Reward Duel settlements and trigger safe retries.
          </p>
        </div>

        <section className="rounded-2xl border border-[#F0F0F0] bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto] md:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#525252]">Admin secret</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="ADMIN_QUEUE_SECRET"
                className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm outline-none focus:border-[#238D9D]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#525252]">Statuses</span>
              <input
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm outline-none focus:border-[#238D9D]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#525252]">Limit</span>
              <input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2 text-sm outline-none focus:border-[#238D9D]"
              />
            </label>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-xl bg-[#238D9D] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runAction({ action: "run", limit: 5 }, "Worker batch")}
              disabled={!!actioning}
              className="inline-flex items-center gap-2 rounded-xl border border-[#D8EEF2] bg-[#E8F7F9] px-3 py-2 text-xs font-bold text-[#238D9D] disabled:opacity-50"
            >
              <Play size={14} weight="fill" />
              Run worker batch
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E5E5E5] bg-white px-3 py-2 text-xs font-bold text-[#525252] disabled:opacity-50"
            >
              <ArrowClockwise size={14} />
              Refresh
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <WarningCircle size={14} className="flex-shrink-0 text-red-500" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
          {notice && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
              <CheckCircle size={14} weight="fill" className="flex-shrink-0 text-green-500" />
              <p className="text-xs text-green-700">{notice}</p>
            </div>
          )}
        </section>

        {snapshot && (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-[#F0F0F0] bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-[#817E7E]">Problem jobs</p>
                <p className="mt-1 text-2xl font-black text-[#1A1A1A]">{problemCount}</p>
              </div>
              {["queued", "retrying", "manual_review"].map((status) => (
                <div key={status} className="rounded-2xl border border-[#F0F0F0] bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold capitalize text-[#817E7E]">{status.replace("_", " ")}</p>
                  <p className="mt-1 text-2xl font-black text-[#1A1A1A]">{snapshot.counts[status] ?? 0}</p>
                </div>
              ))}
            </section>

            {snapshot.tableMissing && (
              <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-700">Settlement job table is missing</p>
                <p className="mt-1 text-xs text-red-600">Run migration 016 before using the recovery worker.</p>
              </section>
            )}

            {snapshot.missingJobs.length > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#1A1A1A]">Completed Matches Missing Jobs</h2>
                    <p className="text-xs text-[#817E7E]">These can be recovered by retrying the match ID.</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {snapshot.missingJobs.map((match) => (
                    <div key={match.matchId} className="rounded-xl bg-white px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-mono text-xs font-bold text-[#1A1A1A]">{shortId(match.matchId)}</p>
                            <CopyButton text={match.matchId} />
                          </div>
                          <p className="mt-1 text-xs text-[#817E7E]">
                            {match.modeKey ?? "unknown mode"} - completed {formatDate(match.completedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => runAction({ action: "retry", matchId: match.matchId }, `Retry ${shortId(match.matchId)}`)}
                          disabled={!!actioning}
                          className="rounded-xl bg-[#238D9D] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                          Retry match
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-[#F0F0F0] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#F5F5F5] px-4 py-3">
                <div>
                  <h2 className="text-sm font-bold text-[#1A1A1A]">Settlement Jobs</h2>
                  <p className="text-xs text-[#817E7E]">Generated {formatDate(snapshot.generatedAt)}</p>
                </div>
                <span className="rounded-full bg-[#238D9D1A] px-2.5 py-1 text-xs font-bold text-[#238D9D]">
                  {snapshot.jobs.length} shown
                </span>
              </div>

              {snapshot.jobs.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[#817E7E]">No jobs match this filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[#F5F5F5] text-left text-sm">
                    <thead className="bg-[#FAFAFA] text-xs uppercase text-[#817E7E]">
                      <tr>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Match</th>
                        <th className="px-4 py-3">Winner</th>
                        <th className="px-4 py-3">Reward</th>
                        <th className="px-4 py-3">Attempts</th>
                        <th className="px-4 py-3">Next attempt</th>
                        <th className="px-4 py-3">Error</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5F5F5]">
                      {snapshot.jobs.map((job) => (
                        <tr key={job.id} className="align-top">
                          <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs">{shortId(job.match_id)}</span>
                              <CopyButton text={job.match_id} />
                            </div>
                            <p className="mt-1 text-[11px] text-[#817E7E]">{job.mode_key}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs">{shortId(job.winner_address)}</span>
                              <CopyButton text={job.winner_address} />
                            </div>
                            <p className="mt-1 text-[11px] text-[#817E7E]">
                              {job.winner_score} - {job.loser_score}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <p>{job.win_miles}/{job.los_miles} miles</p>
                            <p className="text-[#817E7E]">${(job.win_credit_cents / 100).toFixed(2)} credit</p>
                          </td>
                          <td className="px-4 py-3 text-xs font-bold">{job.attempts}</td>
                          <td className="px-4 py-3 text-xs text-[#525252]">{formatDate(job.next_attempt_at)}</td>
                          <td className="max-w-xs px-4 py-3">
                            <p className="line-clamp-3 text-xs text-[#817E7E]">{job.last_error ?? "none"}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => runAction({ action: "retry", jobId: job.id }, `Retry ${shortId(job.match_id)}`)}
                              disabled={!!actioning || job.status === "confirmed"}
                              className="rounded-xl bg-[#238D9D] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                            >
                              Retry
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
