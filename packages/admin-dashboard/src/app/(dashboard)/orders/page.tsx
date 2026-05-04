import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";

const FINAL_STATUSES = new Set(["received", "completed", "cancelled"]);

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  placed: "warning",
  accepted: "default",
  packed: "default",
  out_for_delivery: "default",
  delivered: "success",
  received: "success",
  completed: "success",
  cancelled: "destructive",
};

async function getOrders() {
  const { data } = await supabase
    .from("merchant_transactions")
    .select("id, partner_id, user_address, status, item_name, city, amount_cusd, voucher_code, created_at, partners(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []) as unknown as Array<{
    id: string;
    partner_id: string;
    user_address: string | null;
    status: string;
    item_name: string | null;
    city: string | null;
    amount_cusd: number | null;
    voucher_code: string | null;
    created_at: string;
    partners: { name: string } | null;
  }>;
}

export default async function OrdersPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  const orders = await getOrders();
  const active = orders.filter((order) => !FINAL_STATUSES.has(order.status)).length;

  return (
    <div>
      <TopBar title="Orders" subtitle={`${active} active orders across merchants`} />
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-left">Merchant</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">City</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No orders found.</td></tr>
                )}
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{order.item_name ?? order.id.slice(0, 8)}</p>
                      <p className="text-xs text-slate-400">{order.user_address?.slice(0, 10)}...</p>
                      {order.voucher_code && <p className="text-xs text-[#238D9D]">Voucher {order.voucher_code}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{order.partners?.name ?? order.partner_id}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[order.status] ?? "secondary"}>{order.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{order.city ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">${formatNumber(order.amount_cusd ?? 0)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(order.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
