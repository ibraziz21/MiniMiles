import { redirect } from "next/navigation";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";

export default function FundedVoucherLayout({ children }: { children: React.ReactNode }) {
  if (!akibaFundedVouchersAdminFlag()) redirect("/vouchers");
  return children;
}
