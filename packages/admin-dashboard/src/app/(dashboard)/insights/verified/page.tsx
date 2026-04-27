import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

async function getVerifiedInsights() {
  const { data } = await supabase
    .from("verified_insights")
    .select("id, poll_id, summary, key_findings, verified_at, created_at, polls(title, status)")
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as Array<{
    id: string;
    poll_id: string;
    summary: string;
    key_findings: string[] | null;
    verified_at: string | null;
    created_at: string;
    polls: { title: string; status: string } | null;
  }>;
}

export default async function VerifiedReportsPage() {
  const session = await requireAdminSession("insights.read");
  if (!session) redirect("/login");

  const insights = await getVerifiedInsights();

  return (
    <div>
      <TopBar title="Verified Reports" subtitle="Final insight summaries reviewed by AkibaMiles" />
      <div className="grid gap-4 p-6">
        {insights.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-slate-400">No verified reports yet.</CardContent></Card>
        )}
        {insights.map((insight) => (
          <Card key={insight.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/insights/polls/${insight.poll_id}`} className="hover:text-[#238D9D]">
                  {insight.polls?.title ?? "Untitled poll"}
                </Link>
              </CardTitle>
              <p className="text-xs text-slate-400">Updated {formatDate(insight.verified_at ?? insight.created_at)}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-700">{insight.summary}</p>
              {Array.isArray(insight.key_findings) && insight.key_findings.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {insight.key_findings.map((finding: string) => (
                    <span key={finding} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{finding}</span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
