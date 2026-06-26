import { redirect } from "next/navigation";

// Unified with /vouchers VoucherTabs "My vouchers" tab.
// This route is kept as a permanent redirect so any existing links continue to work.
export default function MyVouchersRedirect() {
  redirect("/vouchers");
}
