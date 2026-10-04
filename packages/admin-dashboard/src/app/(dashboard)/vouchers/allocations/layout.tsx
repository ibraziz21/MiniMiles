import { redirect } from "next/navigation";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";

export default function FundedAllocationLayout({ children }: { children: React.ReactNode }) {
  if (!akibaFundedVouchersAdminFlag()) redirect("/vouchers");
  return children;
}
