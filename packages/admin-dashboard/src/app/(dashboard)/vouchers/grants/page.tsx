import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";
import { IssueVoucherFlow, type GrantAllocationOption } from "@/components/vouchers/IssueVoucherFlow";

async function getGrantableAllocations(): Promise<GrantAllocationOption[]> {
  const [{ data: allocations }, { data: availability }] = await Promise.all([
    supabase
      .from("voucher_funding_allocations")
      .select("id, program_id, state, distribution_modes, claim_ends_at, max_reimbursement_minor, partners(name), voucher_funding_programs(name, currency), spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey(title, discount_kes, minimum_spend_kes)")
      .in("state", ["active", "scheduled"])
      .contains("distribution_modes", ["internal_grant"])
      .order("claim_ends_at", { ascending: true }),
    supabase.from("v_voucher_funding_allocation_availability").select("allocation_id, quantity_remaining, available_budget_minor"),
  ]);

  const availabilityByAllocation = new Map((availability ?? []).map((row) => [row.allocation_id, row]));
  return ((allocations ?? []) as unknown as Array<{
    id: string;
    program_id: string;
    state: string;
    claim_ends_at: string;
    max_reimbursement_minor: number;
    partners: { name: string } | null;
    voucher_funding_programs: { name: string; currency: string } | null;
    spend_voucher_templates: { title: string; discount_kes: number; minimum_spend_kes: number } | null;
  }>).map((allocation) => ({
    id: allocation.id,
    fundId: allocation.program_id,
    fundName: allocation.voucher_funding_programs?.name ?? "Voucher fund",
    merchantName: allocation.partners?.name ?? "Unknown merchant",
    title: allocation.spend_voucher_templates?.title ?? "Reimbursable voucher",
    discountKes: Number(allocation.spend_voucher_templates?.discount_kes ?? 0),
    minimumSpendKes: Number(allocation.spend_voucher_templates?.minimum_spend_kes ?? 0),
    maximumReimbursementMinor: Number(allocation.max_reimbursement_minor ?? 0),
    currency: allocation.voucher_funding_programs?.currency ?? "KES",
    expiresAt: allocation.claim_ends_at,
    quantityRemaining: Number(availabilityByAllocation.get(allocation.id)?.quantity_remaining ?? 0),
    availableBudgetMinor: Number(availabilityByAllocation.get(allocation.id)?.available_budget_minor ?? 0),
  }));
}

export default async function VoucherGrantsPage() {
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) redirect("/login");

  const enabled = akibaFundedVouchersAdminFlag();
  const allocations = enabled ? await getGrantableAllocations() : [];

  return (
    <div>
      <PageHeader title="Issue voucher" subtitle="Issue one reimbursable voucher to an eligible member" />
      <div className="p-4 sm:p-6">
        <IssueVoucherFlow allocations={allocations} enabled={enabled} />
      </div>
    </div>
  );
}
