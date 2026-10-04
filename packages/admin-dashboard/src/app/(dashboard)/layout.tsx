import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-[#F6F8FA]">
      <Sidebar
        adminName={session.name}
        adminRole={session.role}
        fundedVouchersEnabled={akibaFundedVouchersAdminFlag()}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
