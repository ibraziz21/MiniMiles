import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const active = ["manual_review", "processing", "requested", "failed", "legal_hold"];
const date = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
export default async function AccountDeletionsPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  if (!await requireAdminSession("deletions.read")) redirect("/login");
  const completed = searchParams.status === "completed";
  const n = Number(searchParams.page ?? 1);
  const page = Number.isSafeInteger(n) && n > 0 && n <= 10000 ? n : 1;
  const now = new Date().toISOString();
  const [queue, overdue] = await Promise.all([
    supabase.from("account_deletion_requests").select("id,status,source,policy_version,requested_at,target_completion_at,completed_at,completion_email_sent_at,failure_code", { count: "exact" }).in("status", completed ? ["completed"] : active).order("requested_at", { ascending: !completed }).order("id").range((page-1)*25,page*25-1),
    supabase.from("account_deletion_requests").select("id", { count: "exact", head: true }).in("status",active).lt("target_completion_at",now),
  ]);
  const ids = (queue.data ?? []).map(r => r.id);
  const cases = ids.length ? await supabase.from("account_deletion_admin_cases").select("request_id,assignee,state,failure_code,verified_at").in("request_id",ids) : { data: [], error: null };
  const failed = queue.error || overdue.error || cases.error;
  return <><PageHeader title="Account deletions" subtitle="Assignments, deadlines, verified cleanup and completion notices" />
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <p role="status" className={`text-sm ${overdue.count ? "font-semibold text-danger" : "text-ink-muted"}`}>{overdue.error ? "Overdue count unavailable" : `${overdue.count ?? 0} overdue requests requiring attention`}</p>
      <nav aria-label="Deletion queue status" className="flex gap-3"><Link className="inline-flex min-h-11 items-center text-primary underline" href="/account-deletions" aria-current={!completed ? "page" : undefined}>Active requests</Link><Link className="inline-flex min-h-11 items-center text-primary underline" href="/account-deletions?status=completed" aria-current={completed ? "page" : undefined}>Completed requests</Link></nav>
      {failed ? <div role="alert" className="rounded-panel border border-danger p-4">The deletion queue could not be loaded. Check the deployment and <Link className="text-primary underline" href={`/account-deletions?status=${completed ? "completed" : "active"}&page=${page}`}>retry</Link>.</div> : <>
        {!queue.data?.length && <p className="rounded-panel border border-border bg-surface p-6">No {completed ? "completed" : "active"} deletion requests on this page.</p>}
        {queue.data?.map(r => { const c = cases.data?.find(item => item.request_id===r.id); const late = !completed && r.target_completion_at<now;
          return <article key={r.id} className="space-y-2 rounded-panel border border-border bg-surface p-4 sm:p-5">
            <h2 className="break-all text-base font-semibold"><Link className="text-primary underline" href={`/account-deletions/${r.id}`}>Request {r.id}</Link></h2>
            <p className="text-sm capitalize">{r.status.replaceAll("_"," ")} · {r.source.replaceAll("_"," ")}{c && <> · Cleanup {c.state}</>}</p>
            <p className={`text-sm ${late ? "font-semibold text-danger" : "text-ink-muted"}`}>{late ? "Overdue · " : ""}Target {date(r.target_completion_at)} EAT</p>
            <p className="break-all text-sm text-ink-muted">{c ? `Assigned admin: ${c.assignee}` : "Unassigned"}</p>
            {(c?.failure_code || r.failure_code) && <p className="break-words text-sm text-danger">Needs review: {(c?.failure_code ?? r.failure_code)?.replaceAll("_"," ")}</p>}
            {completed && <p className="text-sm">{r.completion_email_sent_at ? "Completion email sent" : "Completion email requires follow-up"}</p>}
          </article>; })}
        <nav aria-label="Deletion queue pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {page>1 ? <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/account-deletions?status=${completed ? "completed" : "active"}&page=${page-1}`}>Previous page</Link> : <span />}
          <span>Page {page} · {queue.count ?? 0} requests</span>
          {(queue.count ?? 0)>page*25 ? <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/account-deletions?status=${completed ? "completed" : "active"}&page=${page+1}`}>Next page</Link> : <span />}
        </nav>
      </>}
    </div></>;
}
