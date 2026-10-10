import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface CollectionInvoice {
  id: string;
  invoice_number: string | null;
  payment_reference: string | null;
  partner_id: string;
  type: string;
  status: string;
  balance_kes: number | string;
  due_at: string | null;
  grace_until: string | null;
  plan_snapshot: string | null;
  billing_period_snapshot: string | null;
}

function kes(value: number | string): string {
  return `KES ${Number(value).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function collectionStage(invoice: CollectionInvoice): {
  label: string;
  variant: "secondary" | "warning" | "destructive";
} {
  const now = Date.now();
  const dueAt = invoice.due_at ? new Date(invoice.due_at).getTime() : null;
  const graceUntil = invoice.grace_until ? new Date(invoice.grace_until).getTime() : null;

  if (graceUntil !== null && now >= graceUntil) {
    return { label: "Past grace", variant: "destructive" };
  }
  if (dueAt !== null && now >= dueAt) {
    return { label: "In grace", variant: "warning" };
  }
  return { label: "Upcoming", variant: "secondary" };
}

async function loadCollections() {
  const { data, error } = await supabase
    .from("subscription_invoices")
    .select("id,invoice_number,payment_reference,partner_id,type,status,balance_kes,due_at,grace_until,plan_snapshot,billing_period_snapshot")
    .in("type", ["subscription", "overage"])
    .in("status", ["issued", "overdue", "payment_submitted", "under_review"])
    .gt("balance_kes", 0)
    .order("due_at", { ascending: true });

  if (error) {
    console.error("[finance/subscriptions/collections] invoice load error:", error.message);
    return { invoices: [] as CollectionInvoice[], merchantNames: {} as Record<string, string> };
  }

  const invoices = (data ?? []) as CollectionInvoice[];
  const partnerIds = [...new Set(invoices.map((invoice) => invoice.partner_id))];
  if (partnerIds.length === 0) return { invoices, merchantNames: {} as Record<string, string> };

  const { data: partners } = await supabase.from("partners").select("id,name").in("id", partnerIds);
  const merchantNames = Object.fromEntries((partners ?? []).map((partner) => [partner.id, partner.name]));
  return { invoices, merchantNames };
}

export default async function SubscriptionCollectionsPage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");

  const { invoices, merchantNames } = await loadCollections();

  return (
    <div>
      <PageHeader
        title="Subscription Collections"
        subtitle="Renewal and overage invoices that may need direct merchant follow-up"
      />
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          <Link href="/finance/subscriptions" className="rounded-control bg-surface-subtle px-3 py-1.5 text-sm font-medium text-ink-muted">
            Payment reviews
          </Link>
          <span className="rounded-control bg-primary px-3 py-1.5 text-sm font-medium text-white">Collections</span>
        </div>

        <div className="rounded-card border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          Contact merchants directly when an invoice approaches or passes its due date. The platform remains responsible for automated reminders and the seven-day grace transition.
        </div>

        {invoices.length === 0 ? (
          <EmptyState message="No open renewal or overage invoices." isHealthy />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {invoices.map((invoice) => {
                const stage = collectionStage(invoice);
                return (
                  <div key={invoice.id} className="rounded-card border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/merchants/${invoice.partner_id}`} className="font-medium text-primary hover:underline">
                        {merchantNames[invoice.partner_id] ?? invoice.partner_id}
                      </Link>
                      <Badge variant={stage.variant}>{stage.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {invoice.invoice_number ?? invoice.id.slice(0, 8)} · {invoice.type.replaceAll("_", " ")} · {invoice.status.replaceAll("_", " ")}
                    </p>
                    <p className="mt-2 text-sm text-ink">{kes(invoice.balance_kes)}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Due {formatDateTime(invoice.due_at)} · Grace ends {formatDateTime(invoice.grace_until)}
                    </p>
                    {invoice.payment_reference && (
                      <p className="mt-1 font-mono text-xs text-ink-muted">{invoice.payment_reference}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-card border border-border bg-surface lg:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-surface-subtle text-xs uppercase text-ink-muted">
                  <tr>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Merchant</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Plan / term</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2">Grace ends</th>
                    <th className="px-3 py-2">Payment reference</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const stage = collectionStage(invoice);
                    return (
                      <tr key={invoice.id} className="border-t border-border align-top">
                        <td className="px-3 py-3"><Badge variant={stage.variant}>{stage.label}</Badge></td>
                        <td className="px-3 py-3">
                          <Link href={`/merchants/${invoice.partner_id}`} className="font-medium text-primary hover:underline">
                            {merchantNames[invoice.partner_id] ?? invoice.partner_id}
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-ink">{invoice.invoice_number ?? invoice.id.slice(0, 8)}</div>
                          <div className="text-xs capitalize text-ink-muted">{invoice.type.replaceAll("_", " ")} · {invoice.status.replaceAll("_", " ")}</div>
                        </td>
                        <td className="px-3 py-3 capitalize text-ink">{invoice.plan_snapshot ?? "—"} · {invoice.billing_period_snapshot ?? "—"}</td>
                        <td className="px-3 py-3 text-right font-mono text-ink">{kes(invoice.balance_kes)}</td>
                        <td className="px-3 py-3 text-ink-muted">{formatDateTime(invoice.due_at)}</td>
                        <td className="px-3 py-3 text-ink-muted">{formatDateTime(invoice.grace_until)}</td>
                        <td className="px-3 py-3 font-mono text-xs text-ink-muted">{invoice.payment_reference ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
