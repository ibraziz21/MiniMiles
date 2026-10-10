import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatNumber } from "@/lib/utils";
import { ProgramVersionActions } from "@/components/referrals/ProgramVersionActions";
import { NewProgramDraftForm } from "@/components/referrals/NewProgramDraftForm";

type ProgramVersion = {
  id: string;
  version: number;
  status: "draft" | "active" | "paused" | "ended";
  signup_reward_miles: number;
  activation_reward_miles: number;
  min_purchase_kes: number;
  total_budget_miles: number;
  reserved_budget_miles: number;
  released_budget_miles: number;
  created_at: string;
  published_at: string | null;
};

const STATUS_VARIANT: Record<ProgramVersion["status"], "secondary" | "success" | "warning" | "outline"> = {
  draft: "secondary",
  active: "success",
  paused: "warning",
  ended: "outline",
};

export default async function ReferralProgramPage() {
  const session = await requireAdminSession("referrals.read");
  if (!session) redirect("/login");
  const canWrite = session.role === "super_admin" || session.role === "ops_admin";

  const { data: versions } = await supabase
    .from("referral_program_versions")
    .select("id, version, status, signup_reward_miles, activation_reward_miles, min_purchase_kes, total_budget_miles, reserved_budget_miles, released_budget_miles, created_at, published_at")
    .order("version", { ascending: false });

  const rows = (versions ?? []) as ProgramVersion[];

  return (
    <div>
      <PageHeader title="Referral program versions" subtitle="Published financial settings can't be edited in place — publish a new version instead" />
      <div className="space-y-6 p-4 sm:p-6">
        {canWrite && <NewProgramDraftForm />}

        {rows.length === 0 ? (
          <EmptyState message="No program versions yet." isHealthy={false} />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {rows.map((v) => (
                <div key={v.id} className="rounded-card border border-border bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-ink">v{v.version}</span>
                    <Badge variant={STATUS_VARIANT[v.status]}>{v.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Signup {v.signup_reward_miles} mi · Activation {v.activation_reward_miles} mi · Min {formatNumber(v.min_purchase_kes)} KES
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Budget {formatNumber(v.reserved_budget_miles)} / {formatNumber(v.released_budget_miles)} / {formatNumber(v.total_budget_miles)} · Published {formatDate(v.published_at)}
                  </p>
                  {canWrite && (v.status === "draft" || v.status === "active") && (
                    <div className="mt-2">
                      {v.status === "draft" && <ProgramVersionActions id={v.id} action="publish" />}
                      {v.status === "active" && <ProgramVersionActions id={v.id} action="pause" />}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Version</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Signup</th>
                      <th className="px-4 py-3 text-right">Activation</th>
                      <th className="px-4 py-3 text-right">Min purchase</th>
                      <th className="px-4 py-3 text-right">Budget (reserved / released / total)</th>
                      <th className="px-4 py-3 text-left">Published</th>
                      {canWrite && <th className="px-4 py-3 text-left">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((v) => (
                      <tr key={v.id} className="hover:bg-surface-subtle">
                        <td className="px-4 py-3 font-mono text-ink">v{v.version}</td>
                        <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[v.status]}>{v.status}</Badge></td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{v.signup_reward_miles}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{v.activation_reward_miles}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{formatNumber(v.min_purchase_kes)} KES</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-ink-muted">
                          {formatNumber(v.reserved_budget_miles)} / {formatNumber(v.released_budget_miles)} / {formatNumber(v.total_budget_miles)}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-muted">{formatDate(v.published_at)}</td>
                        {canWrite && (
                          <td className="px-4 py-3">
                            {v.status === "draft" && <ProgramVersionActions id={v.id} action="publish" />}
                            {v.status === "active" && <ProgramVersionActions id={v.id} action="pause" />}
                            {(v.status === "paused" || v.status === "ended") && <span className="text-xs text-ink-muted">—</span>}
                          </td>
                        )}
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
