import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatNumber } from "@/lib/utils";
import type { PollStatus } from "@/types";

const STATUS_VARIANT: Record<PollStatus, "default" | "secondary" | "success" | "warning" | "outline"> = {
  draft: "secondary",
  live: "success",
  closed: "warning",
  verified: "default",
};

type PollListItem = {
  id: string;
  title: string;
  description: string | null;
  status: PollStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  response_count: number;
  reward_queued_count: number;
};

async function getPolls(): Promise<PollListItem[]> {
  const [pollsRes, responsesRes] = await Promise.all([
    supabase.from("polls").select("id, title, description, status, starts_at, ends_at, created_at").order("created_at", { ascending: false }),
    supabase.from("poll_responses").select("poll_id, reward_queued"),
  ]);

  const totalMap: Record<string, number> = {};
  const rewardMap: Record<string, number> = {};
  for (const r of responsesRes.data ?? []) {
    totalMap[r.poll_id] = (totalMap[r.poll_id] ?? 0) + 1;
    if (r.reward_queued) rewardMap[r.poll_id] = (rewardMap[r.poll_id] ?? 0) + 1;
  }

  return (pollsRes.data ?? []).map((p) => ({
    ...p,
    response_count: totalMap[p.id] ?? 0,
    reward_queued_count: rewardMap[p.id] ?? 0,
  }));
}

export default async function PollsPage() {
  const session = await requireAdminSession("polls.read");
  if (!session) redirect("/login");

  const polls = await getPolls();

  return (
    <div>
      <PageHeader title="Polls" subtitle="Survey response data and verified insights" />
      <div className="p-4 sm:p-6">
        {polls.length === 0 ? (
          <EmptyState message="No polls yet." isHealthy={false} />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {polls.map((poll) => (
                <Link
                  key={poll.id}
                  href={`/insights/polls/${poll.id}`}
                  className="block rounded-card border border-border bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-ink">{poll.title}</p>
                    <Badge variant={STATUS_VARIANT[poll.status]}>{poll.status}</Badge>
                  </div>
                  {poll.description && <p className="mt-0.5 text-xs text-ink-muted line-clamp-1">{poll.description}</p>}
                  <p className="mt-2 text-xs text-ink-muted">
                    {formatNumber(poll.response_count)} responses · {formatNumber(poll.reward_queued_count)} rewards queued · {formatDate(poll.created_at)}
                  </p>
                </Link>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden rounded-card border border-border bg-surface overflow-hidden lg:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Poll</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Responses</th>
                      <th className="px-4 py-3 text-right">Rewards Queued</th>
                      <th className="px-4 py-3 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {polls.map((poll) => (
                      <tr key={poll.id} className="hover:bg-surface-subtle transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/insights/polls/${poll.id}`} className="font-medium text-ink hover:text-primary">
                            {poll.title}
                          </Link>
                          {poll.description && (
                            <p className="mt-0.5 text-xs text-ink-muted line-clamp-1">{poll.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[poll.status]}>{poll.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{formatNumber(poll.response_count)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-ink">{formatNumber(poll.reward_queued_count)}</span>
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{formatDate(poll.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
