import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";

async function getFinance() {
  const [ordersRes, invoicesRes] = await Promise.all([
    supabase.from("merchant_transactions").select("id, status, amount_cusd, partner_id, created_at, partners(name)").order("created_at", { ascending: false }),
    supabase.from("payout_invoices").select("id, partner_id, status, amount_cusd, created_at, partners(name)").order("created_at", { ascending: false }).limit(50),
  ]);
  return {
    orders: (ordersRes.data ?? []) as unknown as Array<{
      id: string;
      status: string;
      amount_cusd: number | null;
      partner_id: string;
      created_at: string;
      partners: { name: string } | null;
    }>,
    invoices: (invoicesRes.data ?? []) as unknown as Array<{
      id: string;
      partner_id: string;
      status: string;
      amount_cusd: number | null;
      created_at: string;
      partners: { name: string } | null;
    }>,
  };
}

export default async function FinancePage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");

  const { orders, invoices } = await getFinance();
  const completed = orders.filter((order) => ["delivered", "received", "completed"].includes(order.status));
  const receivable = orders.filter((order) => ["accepted", "packed", "out_for_delivery"].includes(order.status));
  const revenue = completed.reduce((sum, order) => sum + (order.amount_cusd ?? 0), 0);
  const inFlight = receivable.reduce((sum, order) => sum + (order.amount_cusd ?? 0), 0);

  return (
    <div>
      <TopBar title="Finance" subtitle="Merchant revenue, receivables, and payout invoices" />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Completed Revenue</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${formatNumber(Math.round(revenue * 100) / 100)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">In Flight</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${formatNumber(Math.round(inFlight * 100) / 100)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Invoices</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(invoices.length)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Recent Payout Invoices</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invoices.length === 0 && <p className="text-sm text-slate-400">No invoices found.</p>}
              {invoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{invoice.partners?.name ?? invoice.partner_id}</p>
                    <p className="text-xs text-slate-400">{formatDate(invoice.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-700">${formatNumber(invoice.amount_cusd ?? 0)}</span>
                    <Badge variant={invoice.status === "paid" ? "success" : invoice.status === "rejected" ? "destructive" : "warning"}>{invoice.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
