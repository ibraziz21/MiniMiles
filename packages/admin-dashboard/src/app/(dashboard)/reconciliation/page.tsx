import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/utils";
import { DisputeActions } from "@/components/reconciliation/DisputeActions";
import { OrphanedPaymentActions } from "@/components/reconciliation/OrphanedPaymentActions";
import { StuckOrderActions } from "@/components/reconciliation/StuckOrderActions";

// Four queues, each a saved query over the order-lifecycle tables
// (order-lifecycle-completion-spec.md §7). Empty queues = the lifecycle is
// complete -- these counts ARE the definition of done, not a dashboard
// vanity metric.

type OrphanedPayment = { id: string; data: Record<string, unknown>; created_at: string };
type StuckOrder = { id: string; partner_id: string; status: string; created_at: string; sla_deadline: string };
type StaleRefund = {
  id: string; order_id: string; amount_cusd: number | null; amount_kes: number | null;
  payment_currency: string | null; rail: string | null; refund_status: string; created_at: string;
};

// M-Pesa refunds only populate amount_kes; amount_cusd is crypto-only.
function formatRefundAmount(r: StaleRefund): string {
  if (r.rail === "mpesa") {
    return r.amount_kes != null ? `${formatNumber(r.amount_kes)} KES` : "—";
  }
  return r.amount_cusd != null ? `${formatNumber(r.amount_cusd)} ${r.payment_currency ?? ""}` : "—";
}
type OpenDispute = { id: string; partner_id: string; disputed_at: string };

async function getQueues() {
  const [orphaned, stuck, refunds, disputes] = await Promise.all([
    supabase.from("v_orphaned_payments").select("id, data, created_at").order("created_at", { ascending: true }).limit(50),
    supabase.from("v_stuck_orders").select("id, partner_id, status, created_at, sla_deadline").order("sla_deadline", { ascending: true }).limit(50),
    supabase.from("v_stale_refunds").select("id, order_id, amount_cusd, amount_kes, payment_currency, rail, refund_status, created_at").order("created_at", { ascending: true }).limit(50),
    supabase.from("v_open_disputes").select("id, partner_id, disputed_at").order("disputed_at", { ascending: true }).limit(50),
  ]);

  return {
    orphaned: (orphaned.data ?? []) as OrphanedPayment[],
    stuck: (stuck.data ?? []) as StuckOrder[],
    refunds: (refunds.data ?? []) as StaleRefund[],
    disputes: (disputes.data ?? []) as OpenDispute[],
  };
}

export default async function ReconciliationPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  const { orphaned, stuck, refunds, disputes } = await getQueues();
  const total = orphaned.length + stuck.length + refunds.length + disputes.length;

  return (
    <div>
      <TopBar
        title="Reconciliation"
        subtitle={total === 0 ? "All queues clear" : `${total} item${total !== 1 ? "s" : ""} need attention`}
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader><CardTitle>Orphaned payments ({orphaned.length})</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">Payment confirmed &gt;1h ago with no order created.</p>
            {orphaned.length === 0 ? <EmptyRow /> : (
              <div className="space-y-2">
                {orphaned.map((o) => (
                  <div key={o.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                    <div>
                      <p className="font-mono text-xs text-slate-500">payment_ref: {String(o.data.payment_ref ?? "—")}</p>
                      <p className="mt-1 text-slate-700">{String(o.data.error ?? "unknown error")}</p>
                      {o.data.amount_cusd != null && (
                        <p className="mt-1 text-xs text-slate-500">${formatNumber(Number(o.data.amount_cusd))}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-400">{formatDate(o.created_at)}</p>
                    </div>
                    <OrphanedPaymentActions incidentId={o.id} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Stuck orders ({stuck.length})</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">
              Past SLA: placed 24h, accepted 48h, packed 24h, out_for_delivery 72h, provider_pending 15m,
              received 2h, fulfil_failed 6h, retrying 15m.
            </p>
            {stuck.length === 0 ? <EmptyRow /> : (
              <div className="space-y-2">
                {stuck.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                    <div>
                      <p className="font-mono text-xs text-slate-500">{o.id.slice(0, 8)}…</p>
                      <p className="text-slate-700 capitalize">{o.status.replace(/_/g, " ")}</p>
                      <p className="text-xs text-red-500">SLA passed {formatDate(o.sla_deadline)}</p>
                    </div>
                    <StuckOrderActions orderId={o.id} status={o.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Refunds in manual review ({refunds.length})</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">Cancelled &gt;48h ago, still awaiting operator reversal. See the Refunds page to action.</p>
            {refunds.length === 0 ? <EmptyRow /> : (
              <div className="space-y-2">
                {refunds.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-mono text-xs text-slate-500">{r.order_id.slice(0, 8)}…</p>
                    <p className="font-mono text-slate-700">
                      {formatRefundAmount(r)}
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(r.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Disputes open &gt;72h ({disputes.length})</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">Customer reported an issue with a delivered order.</p>
            {disputes.length === 0 ? <EmptyRow /> : (
              <div className="space-y-2">
                {disputes.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
                    <div>
                      <p className="font-mono text-xs text-slate-500">{d.id.slice(0, 8)}…</p>
                      <p className="text-xs text-slate-400">Disputed {formatDate(d.disputed_at)}</p>
                    </div>
                    <DisputeActions orderId={d.id} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyRow() {
  return <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">Nothing here.</p>;
}
