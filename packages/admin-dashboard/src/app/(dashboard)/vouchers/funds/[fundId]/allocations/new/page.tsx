import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { AllocationForm, type MerchantOption } from "@/components/vouchers/AllocationForm";

export default async function NewVoucherAllocationPage({ params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");
  const { fundId } = await params;

  const { data: fund } = await supabase
    .from("voucher_funding_programs")
    .select("id, name, state, country_code")
    .eq("id", fundId)
    .single();
  if (!fund) notFound();
  if (!["approved", "scheduled", "active", "paused"].includes(fund.state)) {
    redirect(`/vouchers/funds/${fundId}`);
  }

  const { data: partners } = await supabase
    .from("partners")
    .select("id, name, country, status")
    .order("name");

  return (
    <div>
      <TopBar title={`New allocation — ${fund.name}`} subtitle="Merchant, benefit, eligibility, distribution, and schedule" />
      <AllocationForm
        fundId={fundId}
        fundCountryCode={fund.country_code}
        merchants={(partners ?? []) as MerchantOption[]}
      />
    </div>
  );
}
