import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { ReferralJobActions } from "@/components/referrals/ReferralJobActions";

type Job = {
  id: string;
  referral_id: string;
  milestone: "signup" | "activation";
  recipient_user_id: string;
  amount_miles: number;
  status: string;
  attempts: number;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: string;
  /** Non-null only for a job that already released once — disambiguates a
   *  stuck reversal delivery from a stuck original credit
   *  (056_referral_reversal_delivery.sql). */
  released_at: string | null;
};

type Referral = {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  qualification_type: string | null;
  qualification_reference: string | null;
  risk_score: number;
  risk_decision: string;
  risk_reason_codes: string[];
};

type ReviewTierReferral = {
  id: string;
  status: string;
  risk_score: number;
  risk_reason_codes: string[];
  referrer_user_id: string;
  referred_user_id: string;
  created_at: string;
};

async function getQueue() {
  const { data: jobs } = await supabase
    .from("referral_reward_jobs")
    .select("id, referral_id, milestone, recipient_user_id, amount_miles, status, attempts, last_error_code, last_error_detail, created_at, released_at")
    .eq("status", "manual_review")
    .order("created_at", { ascending: true })
    .limit(200);

  const jobRows = (jobs ?? []) as Job[];
  if (jobRows.length === 0) return { jobs: [], referralsById: new Map(), emailByUserId: new Map() };

  const referralIds = [...new Set(jobRows.map((j) => j.referral_id))];
  const { data: referrals } = await supabase
    .from("hub_referrals")
    .select("id, referrer_user_id, referred_user_id, qualification_type, qualification_reference, risk_score, risk_decision, risk_reason_codes")
    .in("id", referralIds);

  const referralsById = new Map((referrals ?? []).map((r) => [r.id, r as Referral]));

  const userIds = [...new Set((referrals ?? []).flatMap((r) => [r.referrer_user_id, r.referred_user_id]))];
  const { data: passes } = userIds.length
    ? await supabase.from("hub_user_passes").select("user_id, email").in("user_id", userIds)
    : { data: [] };
  const emailByUserId = new Map((passes ?? []).map((p) => [p.user_id, p.email as string]));

  return { jobs: jobRows, referralsById, emailByUserId };
}

/** referral-system-spec.md §10.3 score 30-59 tier — extended hold, still
 *  progressing normally through the reward pipeline, not blocked. Not
 *  captured by the manual_review job queue above (nothing routes these to
 *  manual_review), so without this they'd be invisible to ops entirely
 *  despite risk_decision='review' being exactly what §10.2 asks to make
 *  auditable ("scores are a routing mechanism ... reason codes ... stored
 *  for auditability"). */
async function getReviewTier() {
  const { data } = await supabase
    .from("hub_referrals")
    .select("id, status, risk_score, risk_reason_codes, referrer_user_id, referred_user_id, created_at")
    .eq("risk_decision", "review")
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []) as ReviewTierReferral[];
}

function maskEmail(email: string | undefined): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export default async function ReferralQueuePage() {
  const session = await requireAdminSession("referrals.read");
  if (!session) redirect("/login");
  const canWrite = session.role === "super_admin" || session.role === "ops_admin";
  const isReadonly = session.role === "readonly";

  const [{ jobs, referralsById, emailByUserId }, reviewTier] = await Promise.all([getQueue(), getReviewTier()]);
  const emailByUserIdForReview = new Map<string, string>();
  if (reviewTier.length > 0) {
    const reviewUserIds = [...new Set(reviewTier.flatMap((r) => [r.referrer_user_id, r.referred_user_id]))];
    const { data: passes } = await supabase.from("hub_user_passes").select("user_id, email").in("user_id", reviewUserIds);
    for (const p of passes ?? []) emailByUserIdForReview.set(p.user_id, p.email as string);
  }

  return (
    <div>
      <PageHeader title="Referral review queue" subtitle={`${jobs.length} reward job${jobs.length === 1 ? "" : "s"} awaiting review`} />
      <div className="p-4 sm:p-6">
        {jobs.length === 0 ? (
          <EmptyState message="Nothing needs review." isHealthy />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {jobs.map((job) => {
                const referral = referralsById.get(job.referral_id);
                return (
                  <div key={job.id} className="rounded-card border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-xs text-ink-muted">{job.referral_id.slice(0, 8)}…</p>
                      <span className="font-mono text-sm text-ink">{formatNumber(job.amount_miles)} mi</span>
                    </div>
                    <p className="mt-1 text-sm text-ink">
                      {maskEmail(emailByUserId.get(referral?.referrer_user_id ?? ""))} → {maskEmail(emailByUserId.get(referral?.referred_user_id ?? ""))}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      <span className="capitalize">{job.milestone}</span>
                      {job.released_at && <Badge variant="outline" className="ml-1.5 align-middle">reversal</Badge>}
                      {" · "}
                      {referral?.qualification_type ?? "—"} · queued {formatDateTime(job.created_at)}
                    </p>
                    {!isReadonly && (
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={referral?.risk_decision === "block" ? "destructive" : "warning"}>
                          risk {referral?.risk_score ?? 0}
                        </Badge>
                        {referral?.risk_reason_codes && referral.risk_reason_codes.length > 0 && (
                          <p className="text-[11px] text-ink-muted">{referral.risk_reason_codes.join(", ")}</p>
                        )}
                      </div>
                    )}
                    {job.last_error_code && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {job.last_error_code}
                        {job.attempts > 0 && ` (${job.attempts} attempts)`}
                      </p>
                    )}
                    {canWrite && (
                      <div className="mt-3">
                        <ReferralJobActions jobId={job.id} referralId={job.referral_id} jobStatus={job.status} showReverse={false} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Referral</th>
                      <th className="px-4 py-3 text-left">Referrer → Referred</th>
                      <th className="px-4 py-3 text-left">Milestone</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-left">Proof</th>
                      {!isReadonly && <th className="px-4 py-3 text-left">Risk</th>}
                      <th className="px-4 py-3 text-left">Last error</th>
                      <th className="px-4 py-3 text-left">Queued</th>
                      {canWrite && <th className="px-4 py-3 text-left">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {jobs.map((job) => {
                      const referral = referralsById.get(job.referral_id);
                      return (
                        <tr key={job.id} className="align-top hover:bg-surface-subtle">
                          <td className="px-4 py-3 font-mono text-xs text-ink-muted">{job.referral_id.slice(0, 8)}…</td>
                          <td className="px-4 py-3 text-xs text-ink">
                            {maskEmail(emailByUserId.get(referral?.referrer_user_id ?? ""))}
                            <br />→ {maskEmail(emailByUserId.get(referral?.referred_user_id ?? ""))}
                          </td>
                          <td className="px-4 py-3 text-ink">
                            <span className="capitalize">{job.milestone}</span>
                            {job.released_at && (
                              <Badge variant="outline" className="ml-1.5 align-middle">reversal</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-ink">{formatNumber(job.amount_miles)}</td>
                          <td className="px-4 py-3 text-xs text-ink-muted">
                            {referral?.qualification_type ?? "—"}
                            {referral?.qualification_reference && (
                              <p className="font-mono text-[11px] text-ink-muted">{referral.qualification_reference}</p>
                            )}
                          </td>
                          {!isReadonly && (
                            <td className="px-4 py-3">
                              <Badge variant={referral?.risk_decision === "block" ? "destructive" : "warning"}>
                                {referral?.risk_score ?? 0}
                              </Badge>
                              {referral?.risk_reason_codes && referral.risk_reason_codes.length > 0 && (
                                <p className="mt-1 max-w-[160px] text-[11px] text-ink-muted">
                                  {referral.risk_reason_codes.join(", ")}
                                </p>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3 max-w-[180px] text-xs text-ink-muted">
                            {job.last_error_code ?? "—"}
                            {job.attempts > 0 && <span className="text-ink-muted"> ({job.attempts} attempts)</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-ink-muted">{formatDateTime(job.created_at)}</td>
                          {canWrite && (
                            <td className="px-4 py-3">
                              <ReferralJobActions
                                jobId={job.id}
                                referralId={job.referral_id}
                                jobStatus={job.status}
                                showReverse={false}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!isReadonly && (
          <Card className="mt-6">
            <CardHeader><CardTitle>Extended-hold referrals ({reviewTier.length})</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ink-muted">
                Risk score 30-59 — not blocked, holds doubled automatically. Progressing normally through the
                reward pipeline; shown here for visibility only, not action.
              </p>
              {reviewTier.length === 0 ? (
                <p className="rounded-card border border-dashed border-border py-6 text-center text-sm text-ink-muted">Nothing on extended hold.</p>
              ) : (
                <div className="space-y-2">
                  {reviewTier.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/30 bg-warning/5 p-3 text-sm">
                      <Link href={`/referrals/lookup?q=${r.id}`} className="font-mono text-xs text-primary underline-offset-2 hover:underline">
                        {r.id.slice(0, 8)}…
                      </Link>
                      <p className="text-xs text-ink">
                        {maskEmail(emailByUserIdForReview.get(r.referrer_user_id))} → {maskEmail(emailByUserIdForReview.get(r.referred_user_id))}
                      </p>
                      <p className="text-ink">status: {r.status}</p>
                      <Badge variant="warning">{r.risk_score}</Badge>
                      <p className="max-w-[200px] text-[11px] text-ink-muted">{r.risk_reason_codes.join(", ")}</p>
                      <p className="text-xs text-ink-muted">{formatDateTime(r.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
