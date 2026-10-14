import Link from "next/link";
import { redirect } from "next/navigation";
import { Filter, Send, TicketCheck } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { getVoucherMemberDetails } from "@/lib/voucherMemberDetails";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { formatDateTime, formatMoney, formatNumber, minorToMajor } from "@/lib/utils";

const STATUSES = ["issued", "redeemed", "expired", "revoked"] as const;
const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  issued: "success",
  redeemed: "secondary",
  expired: "warning",
  revoked: "destructive",
};

interface VoucherRow {
  id: string;
  code: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  max_reimbursement_minor: number | null;
  funding_allocation_id: string;
  partners: { id: string; name: string } | null;
  voucher_funding_allocations: {
    id: string;
    program_id: string;
    voucher_funding_programs: { name: string } | null;
    spend_voucher_templates: { title: string } | null;
  } | null;
}

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export default async function IssuedVouchersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");

  const filters = await searchParams;
  const selectedFund = param(filters.fund);
  const selectedAllocation = param(filters.allocation);
  const selectedMerchant = param(filters.merchant);
  const selectedStatus = param(filters.status);
  const recipient = param(filters.recipient).replace(/^@/, "").toLowerCase();

  const { data, error } = await supabase
    .from("issued_vouchers")
    .select("id, code, status, expires_at, created_at, max_reimbursement_minor, funding_allocation_id, partners(id, name), voucher_funding_allocations(id, program_id, voucher_funding_programs(name), spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey(title))")
    .not("funding_allocation_id", "is", null)
    .in("funding_mode", ["akiba_reimbursement", "sponsor_reimbursement"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) console.error("[issued-vouchers:page]", error.message);
  const vouchers = (data ?? []) as unknown as VoucherRow[];
  const memberDetails = await getVoucherMemberDetails(vouchers.map((voucher) => voucher.id));
  const enriched = vouchers.map((voucher) => ({
    ...voucher,
    username: memberDetails.get(voucher.id)?.username ?? null,
  }));

  const funds = new Map<string, string>();
  const allocations = new Map<string, string>();
  const merchants = new Map<string, string>();
  for (const voucher of enriched) {
    const allocation = voucher.voucher_funding_allocations;
    if (allocation) {
      funds.set(allocation.program_id, allocation.voucher_funding_programs?.name ?? "Voucher fund");
      allocations.set(allocation.id, allocation.spend_voucher_templates?.title ?? "Reimbursable voucher");
    }
    if (voucher.partners) merchants.set(voucher.partners.id, voucher.partners.name);
  }

  const visible = enriched.filter((voucher) => {
    const allocation = voucher.voucher_funding_allocations;
    return (!selectedFund || allocation?.program_id === selectedFund)
      && (!selectedAllocation || voucher.funding_allocation_id === selectedAllocation)
      && (!selectedMerchant || voucher.partners?.id === selectedMerchant)
      && (!selectedStatus || voucher.status === selectedStatus)
      && (!recipient || voucher.username?.toLowerCase().includes(recipient));
  });
  const counts = Object.fromEntries(STATUSES.map((status) => [status, enriched.filter((voucher) => voucher.status === status).length]));
  const canIssue = hasPermission(session.role, "voucher_funds.grant");

  return (
    <div>
      <PageHeader
        title="Issued vouchers"
        subtitle="Reimbursable voucher register across every fund and merchant"
        actions={canIssue ? <Button asChild><Link href="/vouchers/grants"><Send className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Issue voucher</span><span className="sm:hidden">Issue</span></Link></Button> : undefined}
      />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Available" value={formatNumber(counts.issued ?? 0)} icon={TicketCheck} />
          <MetricCard label="Redeemed" value={formatNumber(counts.redeemed ?? 0)} icon={TicketCheck} />
          <MetricCard label="Expired" value={formatNumber(counts.expired ?? 0)} icon={TicketCheck} />
          <MetricCard label="Revoked" value={formatNumber(counts.revoked ?? 0)} icon={TicketCheck} />
        </div>

        <Card className="border-border p-4 shadow-none sm:p-5">
          <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Filter issued vouchers">
            <FilterField label="Fund" name="fund" value={selectedFund} options={funds} />
            <FilterField label="Allocation" name="allocation" value={selectedAllocation} options={allocations} />
            <FilterField label="Merchant" name="merchant" value={selectedMerchant} options={merchants} />
            <div>
              <label htmlFor="recipient" className="text-xs font-medium text-ink">Recipient</label>
              <input id="recipient" name="recipient" autoComplete="off" spellCheck={false} defaultValue={recipient} placeholder="Username…" className="mt-1 min-h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm" />
            </div>
            <div>
              <label htmlFor="status" className="text-xs font-medium text-ink">State</label>
              <select id="status" name="status" defaultValue={selectedStatus} className="mt-1 min-h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm">
                <option value="">All states</option>
                {STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" className="min-h-11 flex-1"><Filter className="h-4 w-4" aria-hidden="true" />Apply</Button>
              <Button asChild type="button" variant="outline" className="min-h-11"><Link href="/vouchers/issued">Clear</Link></Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden border-border shadow-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
            <div><h2 className="text-sm font-semibold text-ink">Voucher register</h2><p className="text-xs text-ink-muted">Showing {formatNumber(visible.length)} of {formatNumber(enriched.length)} recent reimbursable vouchers</p></div>
          </div>
          {error ? (
            <div role="alert" className="p-5 text-sm text-danger">The voucher register could not be loaded.</div>
          ) : visible.length === 0 ? (
            <EmptyState icon={TicketCheck} message="No reimbursable vouchers match these filters." className="border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((voucher) => {
                const allocation = voucher.voucher_funding_allocations;
                const href = allocation ? `/vouchers/funds/${allocation.program_id}/allocations/${allocation.id}` : "/vouchers/funds";
                return (
                  <li key={voucher.id} className="[contain-intrinsic-size:auto_76px] [content-visibility:auto]">
                    <Link href={href} className="grid min-h-[76px] gap-2 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4 sm:px-5">
                      <div className="min-w-0"><p className="truncate font-mono text-xs font-semibold text-ink">{voucher.code}</p><p className="mt-1 truncate text-xs text-ink-muted">@{voucher.username ?? "username unavailable"} · {voucher.partners?.name ?? "Unknown merchant"}</p></div>
                      <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{allocation?.spend_voucher_templates?.title ?? "Reimbursable voucher"}</p><p className="truncate text-xs text-ink-muted">{allocation?.voucher_funding_programs?.name ?? "Voucher fund"}</p></div>
                      <div className="text-left sm:text-right"><p className="text-sm font-semibold tabular-nums text-ink">{formatMoney(minorToMajor(voucher.max_reimbursement_minor ?? 0), "KES")}</p><p className="text-xs text-ink-muted">{voucher.expires_at ? `Expires ${formatDateTime(voucher.expires_at)}` : `Issued ${formatDateTime(voucher.created_at)}`}</p></div>
                      <Badge variant={STATUS_VARIANT[voucher.status] ?? "secondary"}>{voucher.status}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function FilterField({ label, name, value, options }: { label: string; name: string; value: string; options: Map<string, string> }) {
  return (
    <div>
      <label htmlFor={name} className="text-xs font-medium text-ink">{label}</label>
      <select id={name} name={name} defaultValue={value} className="mt-1 min-h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm">
        <option value="">All {label.toLowerCase()}s</option>
        {Array.from(options.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
      </select>
    </div>
  );
}
