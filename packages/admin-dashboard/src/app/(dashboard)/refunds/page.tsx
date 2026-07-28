import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import { RefundActions } from "@/components/finance/RefundActions";

type Refund = {
  id: string;
  order_id: string;
  user_address: string;
  amount_cusd: number | null;
  amount_kes: number | null;
  payment_ref: string | null;
  payment_currency: string | null;
  voucher_reinstated: boolean;
  refund_status: "pending_manual" | "refunded" | "not_applicable";
  rail: "mpesa" | "crypto" | "miles" | null;
  reason: string | null;
  refund_tx_hash: string | null;
  created_at: string;
  partners: { name: string } | null;
};

// M-Pesa refunds only ever populate amount_kes (the rail-native amount);
// amount_cusd is crypto-only. Showing amount_cusd unconditionally made
// every M-Pesa refund render "—" here.
function formatRefundAmount(r: Refund): string {
  if (r.rail === "mpesa") {
    return r.amount_kes != null ? `${formatNumber(r.amount_kes)} KES` : "—";
  }
  return r.amount_cusd != null ? `${formatNumber(r.amount_cusd)} ${r.payment_currency ?? ""}` : "—";
}

const STATUS_VARIANT: Record<Refund["refund_status"], "warning" | "success" | "secondary"> = {
  pending_manual: "warning",
  refunded: "success",
  not_applicable: "secondary",
};

async function getRefunds() {
  const { data } = await supabase
    .from("order_cancellation_compensations")
    .select(
      "id, order_id, user_address, amount_cusd, amount_kes, payment_ref, payment_currency, voucher_reinstated, refund_status, rail, reason, refund_tx_hash, created_at, partners(name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as Refund[];
}

export default async function RefundsPage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");

  const refunds = await getRefunds();
  const pending = refunds.filter((r) => r.refund_status === "pending_manual").length;

  return (
    <div>
      <TopBar title="Refunds" subtitle={`${pending} awaiting manual reversal`} />
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-left">Merchant</th>
                  <th className="px-4 py-3 text-left">Rail</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Voucher</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {refunds.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No refunds recorded.</td></tr>
                )}
                {refunds.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.order_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-slate-700">{r.partners?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{r.rail ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                      {formatRefundAmount(r)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{r.reason ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.voucher_reinstated ? <span className="text-emerald-600">Reinstated</span> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[r.refund_status]}>{r.refund_status}</Badge>
                      {r.refund_tx_hash && <p className="mt-0.5 text-xs text-slate-400 font-mono">{r.refund_tx_hash}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3">
                      {r.refund_status === "pending_manual" ? (
                        <RefundActions id={r.id} />
                      ) : (
                        <span className="text-xs text-slate-400">Resolved</span>
                      )}
                    </td>
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
