import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { AccountDeletionActions } from "@/components/deletions/AccountDeletionActions";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";

export const dynamic = "force-dynamic";
const date = (s: string | null) => s ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })+" EAT" : "Not recorded";
export default async function AccountDeletionDetail({ params }: { params: { id: string } }) {
  const session = await requireAdminSession("deletions.read");
  if (!session) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [request, assigned, events] = await Promise.all([
    supabase.from("account_deletion_requests").select("id,status,source,policy_version,requested_at,target_completion_at,completed_at,completion_email_sent_at,completion_email_attempts,completion_email_failure_code,completion_email_next_retry_at,completion_contact_expires_at,evidence_expires_at").eq("id",params.id).maybeSingle(),
    supabase.from("account_deletion_admin_cases").select("assignee,state,lease_until,failure_code,verified_at").eq("request_id",params.id).maybeSingle(),
    supabase.from("account_deletion_events").select("id,event_type,actor_kind,metadata,created_at").eq("request_id",params.id).order("created_at",{ascending:false}).order("id").limit(50),
  ]);
  if (!request.error && !request.data) notFound();
  const failed = request.error || assigned.error || events.error;
  const r = request.data; const c = assigned.data;
  const canWrite = hasPermission(session.role,"deletions.write") && Boolean(adminIdForWrite(session));
  return <><PageHeader title="Deletion request" subtitle="Full shared-account cleanup and verification" /><div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href="/account-deletions">Back to deletion queue</Link>
    {failed || !r ? <p role="alert">Request details could not be loaded. Refresh to retry.</p> : <>
      <section aria-label="Request details" className="space-y-3 rounded-panel border border-border bg-surface p-4 sm:p-5">
        <h2 className="break-all text-lg font-semibold">Request {r.id}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{[
          ["Status",r.status.replaceAll("_"," ")],["Notice version",r.policy_version],["Requested",date(r.requested_at)],["Completion target",date(r.target_completion_at)],
          ["Assigned admin",c?.assignee ?? "Unassigned"],["Cleanup state",c?.state ?? "Not started"],["Verified",date(c?.verified_at ?? null)],["Completed",date(r.completed_at)],
          ["Completion email",r.completion_email_sent_at ? `Sent ${date(r.completion_email_sent_at)}` : r.status === "completed" ? "Not delivered" : "Not due until cleanup completes"],
          ["Email attempts",String(r.completion_email_attempts)],["Next email attempt",date(r.completion_email_next_retry_at)],["Contact expires",date(r.completion_contact_expires_at)],
          ["Proof expires",date(r.evidence_expires_at)],
        ].map(([label,value]) => <div key={label}><dt className="font-medium text-ink-muted">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
        {c?.lease_until && <p className="text-sm">Execution lease until {date(c.lease_until)}. After an interrupted run, wait until the lease expires before retrying.</p>}
        {(c?.failure_code || r.completion_email_failure_code) && <p role="status" className="break-words text-sm text-danger">{(c?.failure_code ?? r.completion_email_failure_code)?.replaceAll("_"," ")}</p>}
      </section>
      {canWrite ? <AccountDeletionActions requestId={r.id} assignedToMe={c?.assignee===session.adminUserId} completed={r.status==="completed"} /> : <p className="text-sm text-ink-muted">A named deletion operator is required to run cleanup.</p>}
      <section className="space-y-3"><h2 className="text-lg font-semibold">Recent audit history</h2><p className="text-sm text-ink-muted">Latest 50 events. Member contact details and Storage keys are not displayed.</p>
        <ol className="space-y-2">{events.data?.map(event => <li key={event.id} className="rounded-panel border border-border bg-surface p-3 text-sm"><p className="font-medium">{event.event_type.replaceAll("_"," ")}</p><p className="text-ink-muted">{date(event.created_at)} · {event.actor_kind}</p>{typeof event.metadata?.actor === "string" && <p className="break-all">Admin {event.metadata.actor}</p>}{typeof event.metadata?.step === "string" && <p>Step {event.metadata.step.replaceAll("_"," ")}</p>}{typeof event.metadata?.reason === "string" && <p className="break-words">{event.metadata.reason.replaceAll("_"," ")}</p>}</li>)}</ol>
      </section>
    </>}
  </div></>;
}
