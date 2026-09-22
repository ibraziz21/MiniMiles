import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { TopBar } from "@/components/layout/TopBar";
import SettlementOperations from "./SettlementOperations";

export default async function SettlementPage() {
  const session = await requireAdminSession("voucher_settlements.read");
  if (!session) redirect("/login");
  return (
    <div>
      <TopBar title="Voucher Reimbursements" subtitle="Merchant payables, batches, and reconciliation" />
      <SettlementOperations canWrite={hasPermission(session.role, "voucher_settlements.write")} />
    </div>
  );
}
