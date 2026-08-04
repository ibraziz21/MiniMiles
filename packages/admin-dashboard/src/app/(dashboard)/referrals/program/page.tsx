import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
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
      <TopBar title="Referral program versions" subtitle="Published financial settings can't be edited in place — publish a new version instead" />
      <div className="space-y-6 p-6">
        {canWrite && <NewProgramDraftForm />}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
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
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No program versions yet.</td></tr>
                )}
                {rows.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">v{v.version}</td>
                    <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[v.status]}>{v.status}</Badge></td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{v.signup_reward_miles}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{v.activation_reward_miles}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{formatNumber(v.min_purchase_kes)} KES</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">
                      {formatNumber(v.reserved_budget_miles)} / {formatNumber(v.released_budget_miles)} / {formatNumber(v.total_budget_miles)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(v.published_at)}</td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        {v.status === "draft" && <ProgramVersionActions id={v.id} action="publish" />}
                        {v.status === "active" && <ProgramVersionActions id={v.id} action="pause" />}
                        {(v.status === "paused" || v.status === "ended") && <span className="text-xs text-slate-400">—</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
