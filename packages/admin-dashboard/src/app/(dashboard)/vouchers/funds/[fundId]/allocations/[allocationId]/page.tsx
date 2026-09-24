import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AllocationActions } from "@/components/vouchers/AllocationActions";
import { IssuedVouchersPanel, type IssuedVoucherRow } from "@/components/vouchers/IssuedVouchersPanel";
import { getVoucherMemberDetails } from "@/lib/voucherMemberDetails";
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
};

export default async function VoucherAllocationDetailPage({
  params,
}: {
  params: Promise<{ fundId: string; allocationId: string }>;
}) {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");
  const { fundId, allocationId } = await params;

  const [{ data: allocation }, { data: availability }, { data: issuedVouchers }] = await Promise.all([
    supabase
      .from("voucher_funding_allocations")
      .select(
        "*, spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey(title, description, discount_kes, minimum_spend_kes, terms_text, active, lifecycle_state), partners(name, country)",
      )
      .eq("id", allocationId)
      .single(),
    supabase.from("v_voucher_funding_allocation_availability").select("*").eq("allocation_id", allocationId).single(),
    supabase
      .from("issued_vouchers")
      .select("id, code, status, expires_at, created_at, revoked_reason, partners(name)")
      .eq("funding_allocation_id", allocationId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (!allocation || allocation.program_id !== fundId) notFound();

  const memberDetailsByVoucher = await getVoucherMemberDetails(
    (issuedVouchers ?? []).map((voucher) => voucher.id),
  );

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
    const memberDetails = memberDetailsByVoucher.get(row.id);
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
      revoked_reason: row.revoked_reason,
      merchant_name: row.partners?.name ?? "Unknown merchant",
      username: memberDetails?.username ?? null,
      account_created_at: memberDetails?.accountCreatedAt ?? null,
      account_age_days: memberDetails?.accountAgeDays ?? null,
      country: memberDetails?.country ?? null,
      spend_miles_earned: memberDetails?.spendMilesEarned ?? 0,
    };
  });
  const statusCounts = voucherRows.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});

  const template = allocation.spend_voucher_templates as {
    title: string;
    description: string | null;
    discount_kes: number;
    minimum_spend_kes: number;
    terms_text: string | null;
    active: boolean;
    lifecycle_state: string;
  } | null;
  const merchant = allocation.partners as { name: string; country: string | null } | null;

  const canWrite = hasPermission(session.role, "voucher_funds.write");
  const canApprove = hasPermission(session.role, "voucher_funds.approve");
  const canPublish = hasPermission(session.role, "voucher_funds.publish");

  return (
    <div>
      <TopBar
        title={merchant?.name ?? "Merchant allocation"}
        subtitle={template?.title ?? ""}
        actions={<Badge variant={STATE_VARIANT[allocation.state] ?? "secondary"}>{allocation.state.replaceAll("_", " ")}</Badge>}
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Discount" value={`KES ${template?.discount_kes ?? 0}`} />
            <Stat label="Minimum purchase" value={`KES ${template?.minimum_spend_kes ?? 0}`} />
            <Stat label="Quantity" value={formatNumber(allocation.quantity_cap)} />
            <Stat label="Max exposure" value={formatMoney(minorToKes(allocation.authorized_budget_minor), "KES")} />
            <Stat label="Issued" value={formatNumber(availability?.quantity_claimed_total ?? 0)} />
            <Stat label="Remaining" value={formatNumber(availability?.quantity_remaining ?? allocation.quantity_cap)} />
            <Stat label="Redeemed" value={formatNumber(statusCounts.redeemed ?? 0)} />
            <Stat label="Expired" value={formatNumber(statusCounts.expired ?? 0)} />
            <Stat label="Revoked" value={formatNumber(statusCounts.revoked ?? 0)} />
            <Stat label="Active reserved" value={formatMoney(minorToKes(availability?.active_reserved_minor ?? 0), "KES")} />
            <Stat label="Available budget" value={formatMoney(minorToKes(availability?.available_budget_minor ?? 0), "KES")} />
            <Stat label="Claim window" value={`${formatDateTime(allocation.claim_starts_at)} → ${formatDateTime(allocation.claim_ends_at)}`} />
            <Stat label="Voucher validity" value={`${Math.round(allocation.voucher_validity_seconds / 86400)} days after claim`} />
            <Stat label="Distribution" value={allocation.distribution_modes.join(", ")} />
            <Stat label="Recycles expired inventory" value={allocation.recycle_expired_inventory ? "Yes" : "No"} />
          </CardContent>
        </Card>

        <AllocationActions
          fundId={fundId}
          allocationId={allocation.id}
          state={allocation.state}
          canWrite={canWrite}
          canApprove={canApprove}
          canPublish={canPublish}
        />

        {template?.description && (
          <Card>
            <CardHeader>
              <CardTitle>Customer copy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-slate-600">
              <p>{template.description}</p>
              {template.terms_text && <p className="text-xs text-slate-400">{template.terms_text}</p>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Issued vouchers</CardTitle>
          </CardHeader>
          <CardContent>
            <IssuedVouchersPanel fundId={fundId} vouchers={voucherRows} canRevoke={canPublish} />
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
