import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { SettlementConsole } from "@/components/settlement/SettlementConsole";

export const dynamic = "force-dynamic";

export default async function SettlementPage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Settlement" subtitle="Payout execution, provider controls & reconciliation" />
      <div className="flex-1 overflow-y-auto">
        <SettlementConsole />
      </div>
    </div>
  );
}
