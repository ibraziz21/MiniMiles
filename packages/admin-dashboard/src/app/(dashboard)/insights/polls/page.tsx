import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Poll, PollStatus } from "@/types";

const STATUS_VARIANT: Record<PollStatus, "default" | "secondary" | "success" | "warning" | "outline"> = {
  draft: "secondary",
  live: "success",
  closed: "warning",
  verified: "default",
};

async function getPolls(): Promise<Poll[]> {
  const [pollsRes, totalRes, completeRes] = await Promise.all([
    supabase.from("polls").select("id, title, description, status, starts_at, ends_at, created_at").order("created_at", { ascending: false }),
    supabase.from("poll_responses").select("poll_id"),
    supabase.from("poll_responses").select("poll_id").eq("is_complete", true),
  ]);

  const totalMap: Record<string, number> = {};
  const completeMap: Record<string, number> = {};
  for (const r of totalRes.data ?? []) totalMap[r.poll_id] = (totalMap[r.poll_id] ?? 0) + 1;
  for (const r of completeRes.data ?? []) completeMap[r.poll_id] = (completeMap[r.poll_id] ?? 0) + 1;

  return (pollsRes.data ?? []).map((p) => ({
    ...p,
    response_count: totalMap[p.id] ?? 0,
    complete_count: completeMap[p.id] ?? 0,
  }));
}

export default async function PollsPage() {
  const session = await requireAdminSession("polls.read");
  if (!session) redirect("/login");

  const polls = await getPolls();

  return (
    <div>
      <TopBar title="Polls" subtitle="Survey response data and verified insights" />
      <div className="p-6">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Poll</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Responses</th>
                  <th className="px-4 py-3 text-right">Completion %</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {polls.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No polls yet.</td>
                  </tr>
                )}
                {polls.map((poll) => {
                  const rate = poll.response_count! > 0
                    ? Math.round((poll.complete_count! / poll.response_count!) * 100)
                    : 0;
                  return (
                    <tr key={poll.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/insights/polls/${poll.id}`} className="font-medium text-slate-900 hover:text-[#238D9D]">
                          {poll.title}
                        </Link>
                        {poll.description && (
                          <p className="mt-0.5 text-xs text-slate-400 line-clamp-1">{poll.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[poll.status]}>{poll.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">{formatNumber(poll.response_count!)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={rate >= 70 ? "text-emerald-600 font-medium" : rate >= 40 ? "text-amber-600 font-medium" : "text-slate-500"}>
                          {rate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(poll.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
