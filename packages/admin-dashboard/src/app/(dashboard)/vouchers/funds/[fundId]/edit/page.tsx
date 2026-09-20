import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { TopBar } from "@/components/layout/TopBar";
import { FundForm } from "@/components/vouchers/FundForm";

export default async function EditVoucherFundPage({ params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");
  const { fundId } = await params;

  const { data: fund } = await supabase
    .from("voucher_funding_programs")
    .select("id, version, name, sponsorship_label, country_code, authorized_budget_minor, starts_at, ends_at, cost_center_reference, state, metadata")
    .eq("id", fundId)
    .single();

  if (!fund) notFound();
  if (fund.state !== "draft") {
    redirect(`/vouchers/funds/${fundId}`);
  }

  return (
    <div>
      <TopBar title={`Edit ${fund.name}`} subtitle="Only draft funds can be edited" />
      <FundForm
        initial={{
          id: fund.id,
          version: fund.version,
          name: fund.name,
          sponsorshipLabel: fund.sponsorship_label ?? "Funded by Akiba",
          countryCode: fund.country_code,
          authorizedBudgetKes: minorToKes(fund.authorized_budget_minor),
          startsAt: fund.starts_at,
          endsAt: fund.ends_at,
          costCenterReference: fund.cost_center_reference ?? "",
          notes: (fund.metadata as { notes?: string } | null)?.notes ?? "",
        }}
      />
    </div>
  );
}
