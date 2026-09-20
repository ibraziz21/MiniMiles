import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FundActions } from "@/components/vouchers/FundActions";
import { IssuedVouchersPanel, type IssuedVoucherRow } from "@/components/vouchers/IssuedVouchersPanel";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

const STATE_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "secondary",
  pending_approval: "warning",
  approved: "outline",
  scheduled: "outline",
  active: "success",
  paused: "warning",
  exhausted: "warning",
  ended: "destructive",
  cancelled: "destructive",
};

interface AllocationRow {
  id: string;
  state: string;
  quantity_cap: number;
  max_reimbursement_minor: number;
  authorized_budget_minor: number;
  claim_starts_at: string;
  claim_ends_at: string;
  spend_voucher_templates: { title: string; discount_kes: number; minimum_spend_kes: number } | null;
  partners: { name: string } | null;
}

interface AvailabilityRow {
  allocation_id: string;
  quantity_claimed_total: number;
  quantity_remaining: number;
  active_reserved_minor: number;
  realized_cost_minor: number;
  available_budget_minor: number;
}

export default async function VoucherFundDetailPage({ params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");
  const { fundId } = await params;

  const [{ data: fund }, { data: budget }, { data: allocations }, { data: availability }, { data: ruleSets }] =
    await Promise.all([
      supabase.from("voucher_funding_programs").select("*").eq("id", fundId).single(),
      supabase.from("v_voucher_funding_program_budget").select("*").eq("program_id", fundId).single(),
      supabase
        .from("voucher_funding_allocations")
        .select(
          "id, state, quantity_cap, max_reimbursement_minor, authorized_budget_minor, claim_starts_at, claim_ends_at, spend_voucher_templates(title, discount_kes, minimum_spend_kes), partners(name)",
        )
        .eq("program_id", fundId)
        .order("created_at", { ascending: false }),
      supabase.from("v_voucher_funding_allocation_availability").select("*"),
      supabase
        .from("voucher_eligibility_rule_sets")
        .select("id, version, mode, rules, customer_copy")
        .eq("program_id", fundId)
        .order("version", { ascending: false }),
    ]);

  if (!fund) notFound();

  const availabilityByAllocation = new Map<string, AvailabilityRow>();
  for (const row of (availability ?? []) as AvailabilityRow[]) availabilityByAllocation.set(row.allocation_id, row);

  const allocationIds = (allocations ?? []).map((a) => a.id);
  const { data: issuedVouchers } =
    allocationIds.length > 0
      ? await supabase
          .from("issued_vouchers")
          .select("id, code, status, expires_at, created_at, revoked_reason, partners(name)")
          .in("funding_allocation_id", allocationIds)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [] as unknown[] };

  const voucherRows: IssuedVoucherRow[] = (issuedVouchers ?? []).map((v) => {
    const row = v as unknown as {
      id: string;
      code: string;
      status: string;
      expires_at: string | null;
      created_at: string;
      revoked_reason: string | null;
      partners: { name: string } | null;
    };
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
      revoked_reason: row.revoked_reason,
      merchant_name: row.partners?.name ?? "Unknown merchant",
    };
  });
  const statusCounts = voucherRows.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});

  const canWrite = hasPermission(session.role, "voucher_funds.write");
  const canApprove = hasPermission(session.role, "voucher_funds.approve");
  const canPublish = hasPermission(session.role, "voucher_funds.publish");

  return (
    <div>
      <TopBar
        title={fund.name}
        subtitle={`${fund.country_code} · ${fund.currency} · ${fund.sponsorship_label ?? "Funded by Akiba"}`}
        actions={<Badge variant={STATE_VARIANT[fund.state] ?? "secondary"}>{fund.state.replaceAll("_", " ")}</Badge>}
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Authorized budget" value={formatMoney(minorToKes(fund.authorized_budget_minor), fund.currency)} />
            <Stat
              label="Committed"
              value={formatMoney(minorToKes(budget?.committed_minor ?? 0), fund.currency)}
            />
            <Stat
              label="Available"
              value={formatMoney(minorToKes(budget?.available_budget_minor ?? fund.authorized_budget_minor), fund.currency)}
            />
            <Stat label="Merchants" value={formatNumber(allocations?.length ?? 0)} />
            <Stat label="Schedule" value={`${formatDateTime(fund.starts_at)} → ${formatDateTime(fund.ends_at)}`} />
            <Stat label="Cost center" value={fund.cost_center_reference ?? "—"} />
            <Stat label="Approval revision" value={String(fund.approval_revision)} />
            <Stat label="Approved by" value={fund.approved_by ? `${fund.approved_by} · ${formatDateTime(fund.approved_at)}` : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voucher activity</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Issued" value={formatNumber(statusCounts.issued ?? 0)} />
            <Stat label="Redeemed" value={formatNumber(statusCounts.redeemed ?? 0)} />
            <Stat label="Expired" value={formatNumber(statusCounts.expired ?? 0)} />
            <Stat label="Revoked" value={formatNumber(statusCounts.revoked ?? 0)} />
          </CardContent>
        </Card>

        <FundActions
          fundId={fund.id}
          state={fund.state}
          approvalRevision={fund.approval_revision}
          canWrite={canWrite}
          canApprove={canApprove}
          canPublish={canPublish}
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Merchant allocations</CardTitle>
            {canWrite && ["approved", "scheduled", "active", "paused"].includes(fund.state) && (
              <Button asChild size="sm">
                <Link href={`/vouchers/funds/${fund.id}/allocations/new`}>Add allocation</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(!allocations || allocations.length === 0) && (
              <p className="text-sm text-slate-400">
                {["approved", "scheduled", "active", "paused"].includes(fund.state)
                  ? "No merchant allocations yet."
                  : "Fund must be approved before allocations can be added."}
              </p>
            )}
            {(allocations as unknown as AllocationRow[] | null)?.map((allocation) => {
              const avail = availabilityByAllocation.get(allocation.id);
              return (
                <Link
                  key={allocation.id}
                  href={`/vouchers/funds/${fund.id}/allocations/${allocation.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-3 text-sm hover:border-slate-200 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{allocation.partners?.name ?? "Unknown merchant"}</p>
                    <p className="text-xs text-slate-400">
                      {allocation.spend_voucher_templates?.title} · KES {allocation.spend_voucher_templates?.discount_kes} off
                      · min KES {allocation.spend_voucher_templates?.minimum_spend_kes}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>
                      {formatNumber(avail?.quantity_claimed_total ?? 0)}/{formatNumber(allocation.quantity_cap)} issued
                    </p>
                    <p>Available: {formatMoney(minorToKes(avail?.available_budget_minor ?? 0), fund.currency)}</p>
                  </div>
                  <Badge variant={STATE_VARIANT[allocation.state] ?? "secondary"}>
                    {allocation.state.replaceAll("_", " ")}
                  </Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Eligibility rule sets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(!ruleSets || ruleSets.length === 0) && (
              <p className="text-slate-400">No eligibility rule sets yet — create one when adding an allocation.</p>
            )}
            {ruleSets?.map((rs) => (
              <div key={rs.id} className="rounded-lg border border-slate-100 px-3 py-2">
                <p className="font-medium">
                  v{rs.version} · match {rs.mode}
                </p>
                <p className="text-xs text-slate-400">{rs.customer_copy ?? "No customer-facing copy set."}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Issued vouchers</CardTitle>
          </CardHeader>
          <CardContent>
            <IssuedVouchersPanel fundId={fund.id} vouchers={voucherRows} canRevoke={canPublish} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
