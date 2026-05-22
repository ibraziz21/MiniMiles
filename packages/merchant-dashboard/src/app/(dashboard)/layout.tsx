import { redirect } from "next/navigation";
import { requireMerchantSession } from "@/lib/auth";
import { DashboardShell } from "./DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  return <DashboardShell session={session}>{children}</DashboardShell>;
}
