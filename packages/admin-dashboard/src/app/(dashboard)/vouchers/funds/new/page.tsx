import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { PageHeader } from "@/components/shell/PageHeader";
import { FundForm } from "@/components/vouchers/FundForm";

export default async function NewVoucherFundPage() {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");

  return (
    <div>
      <PageHeader title="New Voucher Fund" subtitle="Step 1 of the fund creation workflow — fund details" />
      <FundForm />
    </div>
  );
}
