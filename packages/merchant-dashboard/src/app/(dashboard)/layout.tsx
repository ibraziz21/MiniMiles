import { redirect } from "next/navigation";
import { requireMerchantSession } from "@/lib/auth";
import { DashboardShell } from "./DashboardShell";
import { DeprecationBanner } from "@/components/layout/DeprecationBanner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  return (
    <>
      <DeprecationBanner />
      <DashboardShell session={session}>{children}</DashboardShell>
    </>
  );
}
