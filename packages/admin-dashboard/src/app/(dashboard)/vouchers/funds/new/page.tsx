import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import { voucherCanvas } from "@/components/vouchers/VoucherUi";
import { FundForm } from "@/components/vouchers/FundForm";

export default async function NewVoucherFundPage() {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) redirect("/login");

  return (
    <div className={voucherCanvas}>
      <VoucherHeader
        title="Create Fund"
        backHref={`/vouchers/funds`}
        name={session.name}
        role={session.role}
      />
      <FundForm />
    </div>
  );
}
