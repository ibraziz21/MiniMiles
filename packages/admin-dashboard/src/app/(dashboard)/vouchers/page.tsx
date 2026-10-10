import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatNumber } from "@/lib/utils";
import { minorToKes } from "@/lib/voucherFunds";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";
import { hasPermission } from "@/types";
import {
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  Landmark,
  Send,
  Store,
  TicketCheck,
  WalletCards,
} from "lucide-react";

interface FundRow {
  id: string;
  name: string;
  state: string;
  currency: string;
  authorized_budget_minor: number;
}

interface BudgetRow {
  program_id: string;
  available_budget_minor: number;
  committed_minor: number;
}

interface AllocationRow {
  id: string;
  program_id: string;
  state: string;
  partners: { name: string } | null;
  voucher_funding_programs: { name: string } | null;
}

async function getRewardsDashboard(fundedEnabled: boolean) {
  const issuedPromise = supabase
    .from("issued_vouchers")
    .select("id, status, funding_mode, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!fundedEnabled) {
    const { data: issued } = await issuedPromise;
    return { issued: issued ?? [], funds: [] as FundRow[], budgets: [] as BudgetRow[], allocations: [] as AllocationRow[] };
  }

  const [issuedRes, fundsRes, budgetsRes, allocationsRes] = await Promise.all([
    issuedPromise,
    supabase
      .from("voucher_funding_programs")
      .select("id, name, state, currency, authorized_budget_minor")
      .in("state", ["pending_approval", "approved", "scheduled", "active", "paused"])
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("v_voucher_funding_program_budget").select("program_id, available_budget_minor, committed_minor"),
    supabase
      .from("voucher_funding_allocations")
      .select("id, program_id, state, partners(name), voucher_funding_programs(name)")
      .in("state", ["draft", "pending_approval", "approved", "paused"])
      .order("updated_at", { ascending: false })
      .limit(6),
  ]);

  return {
    issued: issuedRes.data ?? [],
    funds: (fundsRes.data ?? []) as FundRow[],
    budgets: (budgetsRes.data ?? []) as BudgetRow[],
    allocations: (allocationsRes.data ?? []) as unknown as AllocationRow[],
  };
}

const STATE_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  active: "success",
  scheduled: "outline",
  approved: "outline",
  pending_approval: "warning",
  paused: "warning",
  draft: "secondary",
};

export default async function VouchersPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const canReadVouchers = hasPermission(session.role, "vouchers.read");
  const canReadFunds = hasPermission(session.role, "voucher_funds.read");
  if (!canReadVouchers && !canReadFunds) redirect("/overview");

  const fundedEnabled = akibaFundedVouchersAdminFlag() && canReadFunds;
  const canAllocate = fundedEnabled && hasPermission(session.role, "voucher_funds.write");
  const canIssue = fundedEnabled && hasPermission(session.role, "voucher_funds.grant");
  const { issued, funds, budgets, allocations } = await getRewardsDashboard(fundedEnabled);
  const fundedIssued = issued.filter((voucher) => voucher.funding_mode === "akiba_reimbursement" || voucher.funding_mode === "sponsor_reimbursement");
  const redeemed = fundedIssued.filter((voucher) => voucher.status === "redeemed").length;
  const live = fundedIssued.filter((voucher) => voucher.status === "issued").length;
  const expiredOrRevoked = fundedIssued.filter((voucher) => voucher.status === "expired" || voucher.status === "revoked").length;
  const budgetByFund = new Map(budgets.map((budget) => [budget.program_id, budget]));

  return (
    <div>
      <PageHeader
        title="Rewards"
        subtitle="Reimbursable voucher lifecycle and reward operations"
      />

      <div className="space-y-5 p-4 sm:p-6 lg:space-y-6">
        {fundedEnabled ? (
          <section className="overflow-hidden rounded-[18px] border border-primary/15 bg-primary/[0.045] p-5 shadow-[0_22px_55px_-40px_rgba(15,118,110,0.7)] sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-primary">
                  <WalletCards className="h-4 w-4" aria-hidden="true" /> Reimbursable vouchers
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink sm:text-2xl">Control inventory before money moves.</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">Create and allocate approved funds, issue to eligible members, and monitor voucher states. Reimbursement payment stays in Finance.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {canAllocate && <Button asChild variant="outline" size="lg" className="min-h-11"><Link href="/vouchers/funds"><Landmark className="h-4 w-4" aria-hidden="true" />Allocate fund</Link></Button>}
                {canIssue && <Button asChild size="lg" className="min-h-11"><Link href="/vouchers/grants"><Send className="h-4 w-4" aria-hidden="true" />Issue voucher</Link></Button>}
              </div>
            </div>
          </section>
        ) : (
          <Card className="border-warning/25 bg-warning/[0.04] p-4 text-sm text-ink shadow-none">
            Reimbursable voucher controls are currently disabled by the operations feature flag. Standard voucher reporting remains available.
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard label="Available to members" value={formatNumber(live)} icon={TicketCheck} />
          <MetricCard label="Redeemed" value={formatNumber(redeemed)} icon={BadgeCheck} />
          <MetricCard label="Expired or revoked" value={formatNumber(expiredOrRevoked)} icon={Clock3} className="col-span-2 sm:col-span-1" />
        </div>

        {fundedEnabled && (
          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="overflow-hidden border-border shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Fund health</h2>
                  <p className="text-xs text-ink-muted">Active budgets and remaining availability</p>
                </div>
                <Button asChild variant="ghost" size="sm"><Link href="/vouchers/funds">All funds<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              </div>
              {funds.length === 0 ? (
                <EmptyState icon={Landmark} message="No active or pending voucher funds." className="border-0" />
              ) : (
                <ul className="divide-y divide-border">
                  {funds.map((fund) => {
                    const budget = budgetByFund.get(fund.id);
                    const available = budget?.available_budget_minor ?? fund.authorized_budget_minor;
                    const utilization = fund.authorized_budget_minor > 0 ? Math.min(100, Math.round(((fund.authorized_budget_minor - available) / fund.authorized_budget_minor) * 100)) : 0;
                    return (
                      <li key={fund.id}>
                        <Link href={`/vouchers/funds/${fund.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{fund.name}</p><p className="text-xs text-ink-muted">{formatMoney(minorToKes(available), fund.currency)} available</p></div>
                            <Badge variant={STATE_VARIANT[fund.state] ?? "secondary"}>{fund.state.replaceAll("_", " ")}</Badge>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-label={`${utilization}% of budget committed`} role="img"><div className="h-full rounded-full bg-primary" style={{ width: `${utilization}%` }} /></div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="overflow-hidden border-border shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
                <div><h2 className="text-sm font-semibold text-ink">Allocations requiring action</h2><p className="text-xs text-ink-muted">Draft, approval, and paused inventory</p></div>
                <Button asChild variant="ghost" size="sm"><Link href="/vouchers/allocations">All allocations<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              </div>
              {allocations.length === 0 ? (
                <EmptyState icon={Store} message="No allocations require action." className="border-0" />
              ) : (
                <ul className="divide-y divide-border">
                  {allocations.map((allocation) => (
                    <li key={allocation.id}>
                      <Link href={`/vouchers/funds/${allocation.program_id}/allocations/${allocation.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-control bg-primary/10 text-primary"><Store className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{allocation.partners?.name ?? "Unknown merchant"}</span><span className="block truncate text-xs text-ink-muted">{allocation.voucher_funding_programs?.name ?? "Voucher fund"}</span></span>
                        <Badge variant={STATE_VARIANT[allocation.state] ?? "secondary"}>{allocation.state.replaceAll("_", " ")}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        <Card className="grid gap-3 border-border p-4 shadow-none sm:grid-cols-2 sm:p-5">
          {canReadVouchers && (
            <Link href="/vouchers/pricing" className="group flex min-h-[64px] items-center gap-3 rounded-card border border-border p-3 transition-colors hover:border-primary/25 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="flex h-10 w-10 items-center justify-center rounded-control bg-surface-subtle text-primary"><CircleDollarSign className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Miles voucher pricing</span><span className="block text-xs text-ink-muted">Manage current Miles-to-voucher rates</span></span>
              <ArrowRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          )}
          <Link href="/referrals" className="group flex min-h-[64px] items-center gap-3 rounded-card border border-border p-3 transition-colors hover:border-primary/25 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-surface-subtle text-primary"><BadgeCheck className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Referral rewards</span><span className="block text-xs text-ink-muted">Review funnel and pending rewards</span></span>
            <ArrowRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </Card>
      </div>
    </div>
  );
}
