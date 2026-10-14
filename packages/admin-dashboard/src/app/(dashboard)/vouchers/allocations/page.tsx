import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const canCreate = hasPermission(session.role, "voucher_funds.write");

  const [{ data: allocations }, { data: availability }] = await Promise.all([
    supabase
      .from("voucher_funding_allocations")
      .select(
        "id, program_id, state, quantity_cap, authorized_budget_minor, spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey(title), partners(name), voucher_funding_programs(name)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("v_voucher_funding_allocation_availability").select("allocation_id, quantity_claimed_total, available_budget_minor"),
  ]);

  const availabilityByAllocation = new Map<string, AvailabilityRow>();
  for (const row of (availability ?? []) as AvailabilityRow[]) availabilityByAllocation.set(row.allocation_id, row);

  const rows = (allocations ?? []) as unknown as Row[];

  return (
    <div>
      <PageHeader
        title="Allocations"
        subtitle="Per-merchant voucher quantity, benefit, and exposure across all funds"
        actions={canCreate ? <Button asChild><Link href="/vouchers/funds"><span className="sm:hidden">Allocate</span><span className="hidden sm:inline">Allocate from a fund</span></Link></Button> : undefined}
      />
      <div className="space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Allocation register</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.length === 0 && (
              <div className="flex flex-col items-start gap-3 py-3">
                <p className="text-sm text-ink-muted">No merchant allocations yet. Choose an approved fund to add its first merchant allocation.</p>
                {canCreate && <Button asChild size="sm"><Link href="/vouchers/funds">Choose a fund</Link></Button>}
              </div>
            )}
            {rows.map((row) => {
              const avail = availabilityByAllocation.get(row.id);
              return (
                <Link
                  key={row.id}
                  href={`/vouchers/funds/${row.program_id}/allocations/${row.id}`}
                  className="flex flex-col items-start gap-3 rounded-card border border-border px-3 py-3 text-sm transition-colors hover:border-primary/30 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 w-full flex-1 sm:w-auto">
                    <p className="font-medium text-ink">{row.partners?.name ?? "Unknown merchant"}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">
                      {row.voucher_funding_programs?.name} · {row.spend_voucher_templates?.title}
                    </p>
                  </div>
                  <div className="text-left text-xs leading-5 text-ink-muted sm:text-right">
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
