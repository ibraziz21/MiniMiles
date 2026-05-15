import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RaffleRequirementsForm } from "@/components/games/RaffleRequirementsForm";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type RaffleRequirementRow = {
  id: string;
  round_id: number;
  mode: "all" | "any";
  gates: Array<{ type: string; minUsd?: number }> | null;
  enabled: boolean;
  updated_at: string;
};

async function getRaffleRequirements(): Promise<RaffleRequirementRow[]> {
  const { data, error } = await supabase
    .from("raffle_requirements")
    .select("id, round_id, mode, gates, enabled, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[admin raffles] raffle_requirements fetch failed", error);
    return [];
  }

  return (data ?? []) as RaffleRequirementRow[];
}

function gateLabel(gate: { type: string; minUsd?: number }) {
  if (gate.type === "min_usdt_balance") return `min USDT: ${gate.minUsd ?? 10}`;
  if (gate.type === "prosperity_pass_holder") return "Prosperity Pass";
  if (gate.type === "daily_5tx_completed") return "Daily 5 TX";
  return gate.type;
}

export default async function RaffleOpsPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");
  const requirements = await getRaffleRequirements();

  return (
    <div>
      <TopBar title="Raffle Manager" subtitle="Manage app-level raffle gates" />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader><CardTitle>App-Level Raffle Gates</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <RaffleRequirementsForm />
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Round</th>
                    <th className="px-3 py-2 text-left">Mode</th>
                    <th className="px-3 py-2 text-left">Gates</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requirements.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">#{row.round_id}</td>
                      <td className="px-3 py-2">{row.mode}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {Array.isArray(row.gates) && row.gates.length > 0
                          ? row.gates.map(gateLabel).join(", ")
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={row.enabled ? "success" : "secondary"}>
                          {row.enabled ? "enabled" : "disabled"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{formatDateTime(row.updated_at)}</td>
                    </tr>
                  ))}
                  {requirements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                        No raffle gates configured.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
