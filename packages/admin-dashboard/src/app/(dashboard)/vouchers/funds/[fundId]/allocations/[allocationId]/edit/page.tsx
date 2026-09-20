import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { TopBar } from "@/components/layout/TopBar";
import { AllocationForm } from "@/components/vouchers/AllocationForm";

export default async function EditVoucherAllocationPage({
  params,
}: {
  params: Promise<{ fundId: string; allocationId: string }>;
}) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");
  const { fundId, allocationId } = await params;

  const { data: allocation } = await supabase
    .from("voucher_funding_allocations")
    .select(
      "id, version, state, quantity_cap, authorized_budget_minor, claim_starts_at, claim_ends_at, voucher_validity_seconds, distribution_modes, recycle_expired_inventory, program_id, spend_voucher_templates(title, description, terms_text, discount_kes, minimum_spend_kes), partners(name)",
    )
    .eq("id", allocationId)
    .single();

  if (!allocation || allocation.program_id !== fundId) notFound();
  if (allocation.state !== "draft") redirect(`/vouchers/funds/${fundId}/allocations/${allocationId}`);

  const template = allocation.spend_voucher_templates as unknown as {
    title: string;
    description: string | null;
    terms_text: string | null;
    discount_kes: number;
    minimum_spend_kes: number;
  } | null;
  const merchant = allocation.partners as unknown as { name: string } | null;

  return (
    <div>
      <TopBar title={`Edit allocation — ${merchant?.name ?? ""}`} subtitle="Only draft allocations can be edited" />
      <AllocationForm
        fundId={fundId}
        merchants={[]}
        initial={{
          id: allocation.id,
          version: allocation.version,
          merchantName: merchant?.name ?? "",
          title: template?.title ?? "",
          description: template?.description ?? "",
          termsText: template?.terms_text ?? "",
          discountKes: template?.discount_kes ?? 0,
          minimumSpendKes: template?.minimum_spend_kes ?? 0,
          quantityCap: allocation.quantity_cap,
          authorizedBudgetKes: minorToKes(allocation.authorized_budget_minor),
          claimStartsAt: allocation.claim_starts_at,
          claimEndsAt: allocation.claim_ends_at,
          voucherValidityDays: Math.round(allocation.voucher_validity_seconds / 86400),
          distributionModes: allocation.distribution_modes,
          recycleExpiredInventory: allocation.recycle_expired_inventory,
        }}
      />
    </div>
  );
}
