import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/card";
import { VoucherReimbursementConsole } from "@/components/finance/VoucherReimbursementConsole";
import { getVoucherReimbursementDashboard } from "@/lib/voucherReimbursements";
import { akibaFundedVouchersFinanceFlag } from "@/lib/featureFlags";
import { AlertCircle } from "lucide-react";

export default async function VoucherReimbursementsPage() {
  const session = await requireAdminSession("voucher_settlements.read");
  if (!session) redirect("/login");
  const enabled = akibaFundedVouchersFinanceFlag();
  let data = null;
  let loadError = false;
  if (enabled) {
    try { data = await getVoucherReimbursementDashboard(); } catch (error) { console.error("[voucher-reimbursements:page]", error); loadError = true; }
  }

  return (
    <div>
      <PageHeader title="Voucher reimbursements" subtitle="Merchant payables, payment runs, and reconciliation" />
      <div className="space-y-5 p-4 sm:p-6">
        {!enabled ? (
          <Card className="border-warning/25 bg-warning/[0.04] p-5 shadow-none"><div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" /><div><h2 className="font-semibold text-ink">Reimbursement operations are paused</h2><p className="mt-1 text-sm leading-6 text-ink-muted">The Finance kill switch is off. No batches can be created, submitted, or marked paid.</p></div></div></Card>
        ) : loadError || !data ? (
          <Card className="border-danger/25 bg-danger/[0.04] p-5 shadow-none"><div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" /><div><h2 className="font-semibold text-ink">Reimbursement data is unavailable</h2><p className="mt-1 text-sm leading-6 text-ink-muted">The funded-voucher Finance views may not be deployed yet. No financial action is available.</p></div></div></Card>
        ) : (
          <VoucherReimbursementConsole data={data} canWrite={hasPermission(session.role, "voucher_settlements.write")} canMarkPaid={hasPermission(session.role, "voucher_settlements.mark_paid")} />
        )}
      </div>
    </div>
  );
}
