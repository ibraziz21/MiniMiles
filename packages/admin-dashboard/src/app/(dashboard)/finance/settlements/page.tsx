import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import SettlementOperations from "./SettlementOperations";

export default async function SettlementPage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");
  return (
    <div>
      <TopBar title="Voucher Settlements" subtitle="Merchant reimbursement, batches, and reconciliation" />
      <SettlementOperations canWrite={session.role === "super_admin" || session.role === "finance_admin"} />
    </div>
  );
}
