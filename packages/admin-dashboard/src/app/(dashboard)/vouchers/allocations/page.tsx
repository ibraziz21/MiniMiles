import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber } from "@/lib/utils";

const STATE_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "secondary",
  pending_approval: "warning",
  approved: "outline",
  scheduled: "outline",
  active: "success",
  paused: "warning",
  exhausted: "warning",
  ended: "destructive",
};

interface Row {
  id: string;
  program_id: string;
  state: string;
  quantity_cap: number;
  authorized_budget_minor: number;
  spend_voucher_templates: { title: string } | null;
  partners: { name: string } | null;
  voucher_funding_programs: { name: string } | null;
}

interface AvailabilityRow {
  allocation_id: string;
  quantity_claimed_total: number;
  available_budget_minor: number;
}

// Cross-fund merchant allocation list — see
// packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §6, §9.
export default async function VoucherAllocationsPage() {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");

  const [{ data: allocations }, { data: availability }] = await Promise.all([
    supabase
      .from("voucher_funding_allocations")
      .select(
        "id, program_id, state, quantity_cap, authorized_budget_minor, spend_voucher_templates(title), partners(name), voucher_funding_programs(name)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("v_voucher_funding_allocation_availability").select("allocation_id, quantity_claimed_total, available_budget_minor"),
  ]);

  const availabilityByAllocation = new Map<string, AvailabilityRow>();
  for (const row of (availability ?? []) as AvailabilityRow[]) availabilityByAllocation.set(row.allocation_id, row);

  const rows = (allocations ?? []) as unknown as Row[];

  return (
    <div>
      <TopBar title="Merchant Allocations" subtitle="Per-merchant voucher quantity, benefit, and exposure across all funds" />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Allocations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.length === 0 && <p className="text-sm text-slate-400">No merchant allocations yet.</p>}
            {rows.map((row) => {
              const avail = availabilityByAllocation.get(row.id);
              return (
                <Link
                  key={row.id}
                  href={`/vouchers/funds/${row.program_id}/allocations/${row.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-3 text-sm hover:border-slate-200 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{row.partners?.name ?? "Unknown merchant"}</p>
                    <p className="text-xs text-slate-400">
                      {row.voucher_funding_programs?.name} · {row.spend_voucher_templates?.title}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>
                      {formatNumber(avail?.quantity_claimed_total ?? 0)}/{formatNumber(row.quantity_cap)} issued
                    </p>
                    <p>Available: {formatMoney(minorToKes(avail?.available_budget_minor ?? 0), "KES")}</p>
                  </div>
                  <Badge variant={STATE_VARIANT[row.state] ?? "secondary"}>{row.state.replaceAll("_", " ")}</Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
