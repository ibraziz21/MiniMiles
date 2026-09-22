import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { FundForm } from "@/components/vouchers/FundForm";

export default async function NewVoucherFundPage() {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");

  return (
    <div>
      <TopBar title="New Voucher Fund" subtitle="Step 1 of the fund creation workflow — fund details" />
      <FundForm />
    </div>
  );
}
