import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

// Support lookup (referral-system-spec.md §11.3) — search by referral ID,
// Hub user ID, referral code, email, or Platform ledger reference.
// Read-only roles never see risk_score/risk_reason_codes/rejection_reason_code.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

type Referral = {
  id: string;
  program_version_id: string;
  referrer_user_id: string;
  referred_user_id: string;
  status: string;
  signup_reward_miles: number;
  activation_reward_miles: number;
  qualification_type: string | null;
  qualification_reference: string | null;
  qualified_at: string | null;
  risk_score: number;
  risk_decision: string;
  risk_reason_codes: string[];
  rejection_reason_code: string | null;
  created_at: string;
};

type Job = {
  id: string;
  referral_id: string;
  milestone: string;
  amount_miles: number;
  status: string;
  platform_reference: string | null;
  eligible_at: string;
  released_at: string | null;
};

type LookupResult =
  | { type: "referral"; referral: Referral }
  | { type: "user"; userId: string; asReferrer: Referral[]; asReferred: Referral | null }
  | { type: "not_found" }
  | null;

async function lookup(query: string): Promise<LookupResult> {
  const q = query.trim();
  if (!q) return null;

  if (UUID_RE.test(q)) {
    const { data: referral } = await supabase.from("hub_referrals").select("*").eq("id", q).maybeSingle();
    if (referral) return { type: "referral", referral: referral as Referral };

    const [{ data: asReferrer }, { data: asReferred }] = await Promise.all([
      supabase.from("hub_referrals").select("*").eq("referrer_user_id", q).order("created_at", { ascending: false }),
      supabase.from("hub_referrals").select("*").eq("referred_user_id", q).maybeSingle(),
    ]);
    if ((asReferrer && asReferrer.length > 0) || asReferred) {
      return { type: "user", userId: q, asReferrer: (asReferrer ?? []) as Referral[], asReferred: asReferred as Referral | null };
    }
  }

  const normalizedCode = q.toUpperCase();
  if (CODE_RE.test(normalizedCode)) {
    const { data: code } = await supabase.from("hub_referral_codes").select("hub_user_id").eq("code", normalizedCode).maybeSingle();
    if (code) {
      const { data: asReferrer } = await supabase
        .from("hub_referrals").select("*").eq("referrer_user_id", code.hub_user_id).order("created_at", { ascending: false });
      return { type: "user", userId: code.hub_user_id, asReferrer: (asReferrer ?? []) as Referral[], asReferred: null };
    }
  }

  if (q.includes("@")) {
    const { data: pass } = await supabase.from("hub_user_passes").select("user_id").ilike("email", q).maybeSingle();
    if (pass) {
      const [{ data: asReferrer }, { data: asReferred }] = await Promise.all([
        supabase.from("hub_referrals").select("*").eq("referrer_user_id", pass.user_id).order("created_at", { ascending: false }),
        supabase.from("hub_referrals").select("*").eq("referred_user_id", pass.user_id).maybeSingle(),
      ]);
      return { type: "user", userId: pass.user_id, asReferrer: (asReferrer ?? []) as Referral[], asReferred: asReferred as Referral | null };
    }
  }

  const { data: job } = await supabase.from("referral_reward_jobs").select("referral_id").eq("platform_reference", q).maybeSingle();
  if (job) {
    const { data: referral } = await supabase.from("hub_referrals").select("*").eq("id", job.referral_id).maybeSingle();
    if (referral) return { type: "referral", referral: referral as Referral };
  }

  return { type: "not_found" };
}

async function getJobsForReferrals(referralIds: string[]): Promise<Map<string, Job[]>> {
  if (referralIds.length === 0) return new Map();
  const { data } = await supabase
    .from("referral_reward_jobs")
    .select("id, referral_id, milestone, amount_miles, status, platform_reference, eligible_at, released_at")
    .in("referral_id", referralIds);
  const map = new Map<string, Job[]>();
  for (const job of (data ?? []) as Job[]) {
    const list = map.get(job.referral_id) ?? [];
    list.push(job);
    map.set(job.referral_id, list);
  }
  return map;
}

function JobsTable({ jobs }: { jobs: Job[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-400">
          <th className="py-1 text-left font-medium">Milestone</th>
          <th className="py-1 text-right font-medium">Amount</th>
          <th className="py-1 text-left font-medium">Status</th>
          <th className="py-1 text-left font-medium">Ledger ref</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="border-t border-slate-100">
            <td className="py-1 capitalize">{j.milestone}</td>
            <td className="py-1 text-right font-mono">{j.amount_miles}</td>
            <td className="py-1"><Badge variant={j.status === "released" ? "success" : j.status === "voided" || j.status === "reversed" ? "destructive" : "secondary"}>{j.status}</Badge></td>
            <td className="py-1 font-mono text-slate-400">{j.platform_reference ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReferralCard({ referral, jobs, showRisk }: { referral: Referral; jobs: Job[]; showRisk: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-mono text-sm">{referral.id}</CardTitle>
          <Badge variant={referral.status === "complete" ? "success" : referral.status === "rejected" ? "destructive" : "secondary"}>
            {referral.status.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-4">
          <div><p className="text-slate-400">Signup</p>{referral.signup_reward_miles} mi</div>
          <div><p className="text-slate-400">Activation</p>{referral.activation_reward_miles} mi</div>
          <div><p className="text-slate-400">Qualification</p>{referral.qualification_type ?? "—"}</div>
          <div><p className="text-slate-400">Created</p>{formatDateTime(referral.created_at)}</div>
        </div>
        {showRisk && (
          <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            Risk score {referral.risk_score} · {referral.risk_decision}
            {referral.risk_reason_codes.length > 0 && <> · {referral.risk_reason_codes.join(", ")}</>}
            {referral.rejection_reason_code && <> · rejected: {referral.rejection_reason_code}</>}
          </div>
        )}
        {jobs.length > 0 && <JobsTable jobs={jobs} />}
      </CardContent>
    </Card>
  );
}

export default async function ReferralLookupPage({ searchParams }: { searchParams: { q?: string } }) {
  const session = await requireAdminSession("referrals.read");
  if (!session) redirect("/login");
  const showRisk = session.role !== "readonly";

  const query = searchParams.q ?? "";
  const result = query ? await lookup(query) : null;

  const referralIds =
    result?.type === "referral" ? [result.referral.id]
    : result?.type === "user" ? [...result.asReferrer.map((r) => r.id), ...(result.asReferred ? [result.asReferred.id] : [])]
    : [];
  const jobsByReferral = await getJobsForReferrals(referralIds);

  return (
    <div>
      <TopBar title="Referral lookup" subtitle="Search by referral ID, Hub user ID, referral code, email, or ledger reference" />
      <div className="space-y-6 p-6">
        <form className="flex gap-2" action="/referrals/lookup">
          <Input name="q" defaultValue={query} placeholder="Referral ID, user ID, code, email, or ledger ref…" className="max-w-md" />
          <Button type="submit">Search</Button>
        </form>

        {result?.type === "not_found" && (
          <p className="text-sm text-slate-500">No match found for &quot;{query}&quot;.</p>
        )}

        {result?.type === "referral" && (
          <ReferralCard referral={result.referral} jobs={jobsByReferral.get(result.referral.id) ?? []} showRisk={showRisk} />
        )}

        {result?.type === "user" && (
          <div className="space-y-4">
            <p className="font-mono text-xs text-slate-400">Hub user: {result.userId}</p>
            {result.asReferred && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">As referred friend</p>
                <ReferralCard referral={result.asReferred} jobs={jobsByReferral.get(result.asReferred.id) ?? []} showRisk={showRisk} />
              </div>
            )}
            {result.asReferrer.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  As referrer ({result.asReferrer.length})
                </p>
                <div className="space-y-3">
                  {result.asReferrer.map((r) => (
                    <ReferralCard key={r.id} referral={r} jobs={jobsByReferral.get(r.id) ?? []} showRisk={showRisk} />
                  ))}
                </div>
              </div>
            )}
            {!result.asReferred && result.asReferrer.length === 0 && (
              <p className="text-sm text-slate-500">This user has no referral activity.</p>
            )}
          </div>
        )}

        {!result && (
          <p className="text-sm text-slate-400">Enter a search term above.</p>
        )}
      </div>
    </div>
  );
}
