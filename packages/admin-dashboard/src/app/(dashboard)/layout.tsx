import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { akibaFundedVouchersAdminFlag, akibaFundedVouchersFinanceFlag } from "@/lib/featureFlags";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  return (
    <AppShell
      adminName={session.name}
      adminRole={session.role}
      fundedVouchersEnabled={akibaFundedVouchersAdminFlag()}
      fundedFinanceEnabled={akibaFundedVouchersFinanceFlag()}
    >
      {children}
    </AppShell>
  );
}
