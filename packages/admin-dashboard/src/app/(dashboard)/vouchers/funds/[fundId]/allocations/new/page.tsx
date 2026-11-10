import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { voucherReadAll } from "@/lib/voucherCatalogue";
import { minorToKes } from "@/lib/voucherFunds";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import { voucherCanvas } from "@/components/vouchers/VoucherUi";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { AllocationForm } from "@/components/vouchers/AllocationForm";
export default async function NewVoucherAllocationPage({
  params,
}: {
  params: { fundId: string };
}) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");
  const { fundId } = params;
  const header = (
    <VoucherHeader
      title="Add Allocation"
      backHref={`/vouchers/funds/${fundId}`}
      name={session.name}
      role={session.role}
    />
  );
  const fail = () => (
    <div className={voucherCanvas}>
      {header}
      <div className="p-4">
        <QueueLoadError title="Couldn’t load allocation setup" />
      </div>
    </div>
  );
  const { data: fund, error } = await supabase
    .from("voucher_funding_programs")
    .select("id,name,state,country_code,starts_at,ends_at")
    .eq("id", fundId)
    .maybeSingle();
  if (error) return fail();
  if (!fund) notFound();
  if (!["approved", "scheduled", "active", "paused"].includes(fund.state))
    redirect(`/vouchers/funds/${fundId}`);
  let partners, locations;
  const budget = await supabase
    .from("v_voucher_funding_program_budget")
    .select("available_budget_minor")
    .eq("program_id", fundId)
    .maybeSingle();
  try {
    [partners, locations] = await Promise.all([
      voucherReadAll((from, to) =>
        supabase
          .from("partners")
          .select("id,name,country,status,banner_url,logo_url,image_url")
          .order("name")
          .order("id")
          .range(from, to)
      ),
      voucherReadAll((from, to) =>
        supabase
          .from("merchant_locations")
          .select("partner_id,locality,city,address_line_1")
          .eq("active", true)
          .eq("is_primary", true)
          .order("id")
          .range(from, to)
      ),
    ]);
  } catch {
    return fail();
  }
  const merchants = partners.map((p) => ({
    ...p,
    image_url: p.banner_url || p.image_url || p.logo_url,
    location: locations
      .filter((l) => l.partner_id === p.id)
      .map((l) =>
        [l.address_line_1, l.locality, l.city].filter(Boolean).join(", ")
      )
      .join(" · "),
  }));
  return (
    <div className={voucherCanvas}>
      {header}
      <AllocationForm
        fundId={fundId}
        fundName={fund.name}
        fundCountryCode={fund.country_code}
        fundStartsAt={fund.starts_at}
        fundEndsAt={fund.ends_at}
        availableBudgetKes={
          budget.data ? minorToKes(budget.data.available_budget_minor) : null
        }
        merchants={merchants}
      />
    </div>
  );
}
