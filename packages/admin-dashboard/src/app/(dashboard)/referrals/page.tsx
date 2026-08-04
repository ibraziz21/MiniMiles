import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import { KillSwitchToggle } from "@/components/referrals/KillSwitchToggle";

type ProgramVersion = {
  id: string;
  version: number;
  status: "draft" | "active" | "paused" | "ended";
  signup_reward_miles: number;
  activation_reward_miles: number;
  attribution_window_days: number;
  activation_window_days: number;
  min_purchase_kes: number;
  total_budget_miles: number;
  reserved_budget_miles: number;
  released_budget_miles: number;
};

type Flag = { key: string; enabled: boolean };

const REFERRAL_STATUSES = [
  "pass_activated", "qualified", "complete", "manual_review", "expired", "rejected",
] as const;

const KILL_SWITCHES = [
  { key: "accept_clicks", label: "Accept new referral clicks", description: "Off = /r/[code] stops recording clicks and attributing new visits." },
  { key: "bind_referrals", label: "Bind new referrals", description: "Off = new Pass signups still work, they just never bind to a referrer." },
  { key: "qualify_activations", label: "Qualify activations", description: "Off = completed purchases/vouchers no longer create the 100-Mile job." },
  { key: "release_rewards", label: "Release reward jobs", description: "Off = eligible jobs stay queued (not discarded) until turned back on." },
] as const;

async function getOverviewData() {
  const [{ data: versions }, { data: flags }, statusCounts, { count: clicksTotal }, { count: clicksBound }] = await Promise.all([
    supabase
      .from("referral_program_versions")
      .select("id, version, status, signup_reward_miles, activation_reward_miles, attribution_window_days, activation_window_days, min_purchase_kes, total_budget_miles, reserved_budget_miles, released_budget_miles")
      .order("version", { ascending: false }),
    supabase.from("referral_system_flags").select("key, enabled"),
    Promise.all(
      REFERRAL_STATUSES.map((status) =>
        supabase.from("hub_referrals").select("id", { count: "exact", head: true }).eq("status", status)
          .then(({ count }) => [status, count ?? 0] as const)
      )
    ),
    supabase.from("referral_clicks").select("id", { count: "exact", head: true }),
    supabase.from("referral_clicks").select("id", { count: "exact", head: true }).eq("status", "bound"),
  ]);

  const active = (versions ?? []).find((v) => v.status === "active") as ProgramVersion | undefined;

  return {
    active,
    versionCount: versions?.length ?? 0,
    flags: (flags ?? []) as Flag[],
    statusCounts: Object.fromEntries(statusCounts) as Record<(typeof REFERRAL_STATUSES)[number], number>,
    funnel: { clicksTotal: clicksTotal ?? 0, clicksBound: clicksBound ?? 0 },
  };
}

/** referral-system-spec.md §14.2 budget-threshold alert tiers. */
function budgetAlertTier(remainingPct: number): { label: string; variant: "destructive" | "warning" } | null {
  if (remainingPct < 5) return { label: "Budget below 5%", variant: "destructive" };
  if (remainingPct < 10) return { label: "Budget below 10%", variant: "destructive" };
  if (remainingPct < 20) return { label: "Budget below 20%", variant: "warning" };
  return null;
}

function FunnelStep({ label, count, ofPrevious }: { label: string; count: number; ofPrevious: number | null }) {
  const pct = ofPrevious && ofPrevious > 0 ? Math.round((count / ofPrevious) * 100) : null;
  return (
    <div className="flex-1 rounded-lg border border-slate-200 p-3 text-center">
      <p className="text-xl font-semibold text-slate-900">{formatNumber(count)}</p>
      <p className="text-xs text-slate-500">{label}</p>
      {pct !== null && <p className="mt-0.5 text-xs text-slate-400">{pct}% of prior step</p>}
    </div>
  );
}

export default async function ReferralsOverviewPage() {
  const session = await requireAdminSession("referrals.read");
  if (!session) redirect("/login");
  const canWrite = session.role === "super_admin" || session.role === "ops_admin";

  const { active, versionCount, flags, statusCounts, funnel } = await getOverviewData();
  const flagByKey = new Map(flags.map((f) => [f.key, f.enabled]));

  const remaining = active
    ? active.total_budget_miles - active.reserved_budget_miles - active.released_budget_miles
    : 0;
  const remainingPct = active && active.total_budget_miles > 0 ? (remaining / active.total_budget_miles) * 100 : null;
  const alertTier = remainingPct !== null ? budgetAlertTier(remainingPct) : null;

  const referralsQualifiedOrBetter = statusCounts.qualified + statusCounts.complete;

  return (
    <div>
      <TopBar
        title="Referrals"
        subtitle={active ? `Program v${active.version} active` : "No active program version"}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/referrals/program">Manage program</Link>
          </Button>
        }
      />
      <div className="space-y-6 p-6">
        {active && alertTier && (
          <div className={`rounded-lg border p-3 text-sm ${alertTier.variant === "destructive" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            {alertTier.label} — {formatNumber(remaining)} Miles remaining of {formatNumber(active.total_budget_miles)} on v{active.version}.{" "}
            <Link href="/referrals/program" className="underline underline-offset-2">Publish more budget</Link>.
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Active program</CardTitle>
                {active && <Badge variant="success">v{active.version} · active</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              {!active ? (
                <div className="text-sm text-slate-500">
                  No program version is active — referral clicks and bindings are effectively disabled
                  regardless of the kill switches below.{" "}
                  <Link href="/referrals/program" className="text-[#238D9D] underline underline-offset-2">
                    Publish a draft version
                  </Link>
                  .
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Signup</p>
                      <p className="font-mono text-lg text-slate-900">{active.signup_reward_miles} mi</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Activation</p>
                      <p className="font-mono text-lg text-slate-900">{active.activation_reward_miles} mi</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Min purchase</p>
                      <p className="font-mono text-lg text-slate-900">{formatNumber(active.min_purchase_kes)} KES</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Activation window</p>
                      <p className="font-mono text-lg text-slate-900">{active.activation_window_days}d</p>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                      <span>Budget liability</span>
                      <span>{formatNumber(active.total_budget_miles)} mi total</span>
                    </div>
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${active.total_budget_miles ? (active.reserved_budget_miles / active.total_budget_miles) * 100 : 0}%` }}
                      />
                      <div
                        className="h-full bg-[#238D9D]"
                        style={{ width: `${active.total_budget_miles ? (active.released_budget_miles / active.total_budget_miles) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex gap-4 text-xs text-slate-500">
                      <span><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> reserved: {formatNumber(active.reserved_budget_miles)}</span>
                      <span><span className="inline-block h-2 w-2 rounded-full bg-[#238D9D]" /> released: {formatNumber(active.released_budget_miles)}</span>
                      <span>remaining: {formatNumber(remaining)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kill switches</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-slate-100">
              {KILL_SWITCHES.map((sw) => (
                <KillSwitchToggle
                  key={sw.key}
                  flagKey={sw.key}
                  label={sw.label}
                  description={sw.description}
                  initialEnabled={flagByKey.get(sw.key) ?? true}
                  disabled={!canWrite}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Funnel</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <FunnelStep label="clicks accepted" count={funnel.clicksTotal} ofPrevious={null} />
              <FunnelStep label="bound to a referral" count={funnel.clicksBound} ofPrevious={funnel.clicksTotal} />
              <FunnelStep label="activated (qualified+)" count={referralsQualifiedOrBetter} ofPrevious={funnel.clicksBound} />
              <FunnelStep label="complete" count={statusCounts.complete} ofPrevious={referralsQualifiedOrBetter} />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {REFERRAL_STATUSES.map((status) => (
            <Card key={status}>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold text-slate-900">{formatNumber(statusCounts[status])}</p>
                <p className="text-xs capitalize text-slate-500">{status.replace(/_/g, " ")}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/referrals/queue">Review queue</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/referrals/lookup">Lookup</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/referrals/program">Program versions ({versionCount})</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
