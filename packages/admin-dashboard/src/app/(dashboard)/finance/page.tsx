import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { akibaFundedVouchersFinanceFlag } from "@/lib/featureFlags";
import { hasPermission } from "@/types";
import { ArrowRight, CircleAlert, FileCheck2, HandCoins, Landmark, ReceiptText, WalletCards } from "lucide-react";

async function getFinanceSnapshot() {
  const [payments, collections, payouts] = await Promise.all([
    supabase.from("v_admin_subscription_payment_queue").select("payment_attempt_id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]),
    supabase.from("subscription_invoices").select("balance_kes").in("type", ["subscription", "overage"]).in("status", ["issued", "overdue", "payment_submitted", "under_review"]).gt("balance_kes", 0),
    supabase.from("payout_invoices").select("id, status, net_cusd, created_at, partners(name)").in("status", ["draft", "submitted"]).order("created_at", { ascending: false }).limit(5),
  ]);
  return {
    paymentCount: payments.count ?? 0,
    collectionsCount: collections.data?.length ?? 0,
    collectionsTotal: (collections.data ?? []).reduce((sum, invoice) => sum + Number(invoice.balance_kes ?? 0), 0),
    payouts: (payouts.data ?? []) as unknown as Array<{ id: string; status: string; net_cusd: number | string | null; partners: { name: string } | null }>,
  };
}

export default async function FinancePage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");
  const snapshot = await getFinanceSnapshot();
  const reimbursementsEnabled = akibaFundedVouchersFinanceFlag() && hasPermission(session.role, "voucher_settlements.read");

  return (
    <div>
      <PageHeader title="Finance" subtitle="Payment decisions, collections, and merchant reimbursements" />
      <div className="space-y-5 p-4 sm:p-6 lg:space-y-6">
        <section className="relative overflow-hidden rounded-[18px] bg-ink px-5 py-6 text-white shadow-[0_24px_60px_-34px_rgba(15,23,42,0.8)] sm:px-7 sm:py-7">
          <div aria-hidden="true" className="absolute -right-12 -top-16 h-48 w-48 rounded-full border-[28px] border-white/[0.04]" />
          <div className="relative max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300"><Landmark className="h-4 w-4" aria-hidden="true" /> Finance control room</div>
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Move money with a clear audit trail.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Start with queues that need a decision. Evidence, maker-checker controls, and exact totals remain attached to every payment action.</p>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <FinanceDestination href="/finance/subscriptions" icon={FileCheck2} title="Subscription payments" description="Review submitted evidence and confirm or reject merchant payments." value={`${snapshot.paymentCount} awaiting review`} urgent={snapshot.paymentCount > 0} />
          <FinanceDestination href="/finance/subscriptions/collections" icon={ReceiptText} title="Collections" description="Follow up on renewal and overage invoices before grace periods expire." value={`${snapshot.collectionsCount} open · ${formatMoney(snapshot.collectionsTotal, "KES")}`} urgent={snapshot.collectionsCount > 0} />
          <FinanceDestination href="/finance/voucher-reimbursements" icon={HandCoins} title="Voucher reimbursements" description="Batch reimbursable voucher payables and record merchant payment evidence." value={reimbursementsEnabled ? "Open reimbursement console" : "Operations paused"} disabled={!reimbursementsEnabled} />
        </div>

        <Card className="overflow-hidden border-border shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5"><div><h2 className="text-sm font-semibold text-ink">Merchant payouts</h2><p className="text-xs text-ink-muted">Draft and submitted payout invoices</p></div><Badge variant={snapshot.payouts.length > 0 ? "warning" : "success"}>{snapshot.payouts.length} open</Badge></div>
          {snapshot.payouts.length === 0 ? (
            <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center"><WalletCards className="h-6 w-6 text-success" aria-hidden="true" /><p className="mt-2 text-sm font-medium text-ink">No merchant payouts need attention.</p></div>
          ) : (
            <ul className="divide-y divide-border">
              {snapshot.payouts.map((payout) => <li key={payout.id} className="flex min-h-[60px] items-center gap-3 px-4 py-3 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-control bg-surface-subtle text-primary"><WalletCards className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{payout.partners?.name ?? "Unknown merchant"}</span><span className="block text-xs capitalize text-ink-muted">{payout.status}</span></span><span className="text-sm font-semibold tabular-nums text-ink">${Number(payout.net_cusd ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function FinanceDestination({ href, icon: Icon, title, description, value, urgent, disabled }: { href: string; icon: typeof Landmark; title: string; description: string; value: string; urgent?: boolean; disabled?: boolean }) {
  const content = <><div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-control bg-primary/10 text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>{urgent && <span className="flex items-center gap-1 text-xs font-semibold text-warning"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />Action needed</span>}</div><h2 className="mt-5 text-base font-semibold text-ink">{title}</h2><p className="mt-1 min-h-12 text-sm leading-6 text-ink-muted">{description}</p><div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3"><span className="text-xs font-medium text-ink-muted">{value}</span><ArrowRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></div></>;
  if (disabled) return <Card className="p-4 opacity-70 shadow-none sm:p-5" aria-disabled="true">{content}</Card>;
  return <Link href={href} className="group rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Card className="h-full border-border p-4 shadow-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_45px_-34px_rgba(15,118,110,0.55)] sm:p-5">{content}</Card></Link>;
}
