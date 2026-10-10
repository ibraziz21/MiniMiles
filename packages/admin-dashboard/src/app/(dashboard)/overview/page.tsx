import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { MetricCard } from "@/components/ui/metric-card";
import { AttentionCard, type AttentionItem } from "@/components/ui/attention-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { getQueueSourceSummaries } from "@/lib/queueSources";
import { SLA_BREACH_MINUTES } from "@/lib/subscriptionPayments";
import { hasPermission } from "@/types";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";
import { Users, Store, Tag, ScrollText, AlertTriangle, ArrowRight, Landmark, Send, Sparkles } from "lucide-react";

async function getHeadlineStats() {
  const [usersRes, merchantsRes, vouchersRes] = await Promise.all([
    supabase.from("akiba_users").select("id", { count: "exact", head: true }),
    supabase.from("partners").select("id", { count: "exact", head: true }),
    supabase.from("issued_vouchers").select("id", { count: "exact", head: true }),
  ]);

  return {
    totalMembers: usersRes.count ?? 0,
    totalMerchants: merchantsRes.count ?? 0,
    vouchersIssued: vouchersRes.count ?? 0,
  };
}

interface RecentMerchant {
  id: string;
  name: string;
  country: string | null;
  created_at: string;
  subscription: { plan: string; status: string } | null;
  reviewState: string | null;
}

async function getRecentMerchants(): Promise<RecentMerchant[]> {
  const { data: partners } = await supabase
    .from("partners")
    .select("id, name, country, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  const ids = (partners ?? []).map((partner) => partner.id);
  if (ids.length === 0) return [];

  const [subscriptions, settings] = await Promise.all([
    supabase.from("partner_subscriptions").select("partner_id, plan, status, created_at").in("partner_id", ids).order("created_at", { ascending: false }),
    supabase.from("partner_settings").select("partner_id, directory_status").in("partner_id", ids),
  ]);
  const subscriptionByPartner = new Map<string, { plan: string; status: string }>();
  for (const row of subscriptions.data ?? []) {
    if (!subscriptionByPartner.has(row.partner_id)) {
      subscriptionByPartner.set(row.partner_id, { plan: row.plan, status: row.status });
    }
  }
  const reviewByPartner = new Map((settings.data ?? []).map((row) => [row.partner_id, row.directory_status]));

  return (partners ?? []).map((partner) => ({
    ...partner,
    subscription: subscriptionByPartner.get(partner.id) ?? null,
    reviewState: reviewByPartner.get(partner.id) ?? null,
  }));
}

async function getRecentActivity() {
  const { data } = await supabase
    .from("admin_audit_logs")
    .select("id, action, target_type, target_id, created_at, admin_users(name, email)")
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []) as unknown as Array<{
    id: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    created_at: string;
    admin_users: { name: string | null; email: string } | null;
  }>;
}

export default async function OverviewPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const canSeeFinanceAlerts = hasPermission(session.role, "finance.read");
  const canSeeActivity = hasPermission(session.role, "audit.read");
  const canSeeMerchants = hasPermission(session.role, "merchants.read");
  const fundedVouchersEnabled = akibaFundedVouchersAdminFlag();
  const canAllocate = fundedVouchersEnabled && hasPermission(session.role, "voucher_funds.write");
  const canIssue = fundedVouchersEnabled && hasPermission(session.role, "voucher_funds.grant");

  const [headline, queueSources, activity, recentMerchants] = await Promise.all([
    getHeadlineStats(),
    getQueueSourceSummaries(session.role),
    canSeeActivity ? getRecentActivity() : Promise.resolve([]),
    canSeeMerchants ? getRecentMerchants() : Promise.resolve([]),
  ]);

  const attentionItems: AttentionItem[] = queueSources.map((s) => ({
    id: s.id,
    label: s.label,
    href: s.href,
    count: s.count,
    oldestAgeMinutes: s.oldestAgeMinutes,
  }));

  const subscriptionSource = queueSources.find((s) => s.id === "subscription_payments");
  const subscriptionOverSla =
    canSeeFinanceAlerts &&
    subscriptionSource &&
    (subscriptionSource.oldestAgeMinutes ?? 0) >= SLA_BREACH_MINUTES &&
    subscriptionSource.count > 0;

  return (
    <div>
      <PageHeader title="Overview" subtitle="Today’s operational priorities" />

      <div className="space-y-5 p-4 sm:p-6 lg:space-y-6">
        <section className="relative overflow-hidden rounded-[18px] bg-primary-strong px-5 py-6 text-white shadow-[0_24px_60px_-32px_rgba(15,118,110,0.75)] sm:px-7 sm:py-7">
          <div aria-hidden="true" className="absolute -right-12 -top-16 h-48 w-48 rounded-full border-[28px] border-white/5" />
          <div aria-hidden="true" className="absolute -bottom-16 right-24 h-36 w-36 rounded-full border-[22px] border-white/5" />
          <div className="relative max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-100">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Operator workspace
            </div>
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Move the work that matters today.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-teal-50/85">Resolve urgent queues, allocate approved voucher funds, or issue a reimbursable voucher directly to an eligible member.</p>
            {(canAllocate || canIssue) && (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                {canAllocate && (
                  <Button asChild size="lg" className="min-h-11 bg-white text-primary-strong hover:bg-teal-50">
                    <Link href="/vouchers/funds"><Landmark className="h-4 w-4" aria-hidden="true" />Allocate voucher fund</Link>
                  </Button>
                )}
                {canIssue && (
                  <Button asChild size="lg" variant="outline" className="min-h-11 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                    <Link href="/vouchers/grants"><Send className="h-4 w-4" aria-hidden="true" />Issue voucher</Link>
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <div className="space-y-5">
            <AttentionCard items={attentionItems} />

            {subscriptionOverSla && subscriptionSource && (
              <Card className="flex items-center gap-3 border-danger/25 bg-danger/[0.04] p-4 shadow-none">
                <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-sm text-ink">
                  <strong>{subscriptionSource.count}</strong> subscription payment{subscriptionSource.count !== 1 ? "s" : ""} past review SLA.{" "}
                  <Link href="/finance/subscriptions" className="font-semibold text-danger underline underline-offset-4">Review now</Link>
                </p>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard label="Members" value={formatNumber(headline.totalMembers)} icon={Users} href="/users" />
              <MetricCard label="Merchants" value={formatNumber(headline.totalMerchants)} icon={Store} href="/merchants" />
              <MetricCard label="Vouchers issued" value={formatNumber(headline.vouchersIssued)} icon={Tag} href="/vouchers" className="col-span-2 sm:col-span-1" />
            </div>
          </div>

          {canSeeMerchants && (
            <Card className="overflow-hidden border-border shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-ink">New merchants</h2>
                  <p className="text-xs text-ink-muted">Recently onboarded partners</p>
                </div>
                <Button asChild size="sm" variant="ghost"><Link href="/merchants">View all<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              </div>
              {recentMerchants.length === 0 ? (
                <EmptyState icon={Store} message="No merchants have been onboarded yet." className="border-0" />
              ) : (
                <ul className="divide-y divide-border">
                  {recentMerchants.map((merchant) => (
                    <li key={merchant.id}>
                      <Link href={`/merchants/${merchant.id}`} className="group flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary"><Store className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{merchant.name}</span>
                          <span className="block text-xs text-ink-muted">{merchant.country ?? "Country not set"} · {new Date(merchant.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <Badge variant={merchant.subscription?.status === "active" ? "success" : "outline"}>{merchant.subscription?.status?.replaceAll("_", " ") ?? "No plan"}</Badge>
                          {merchant.reviewState && <span className="text-[11px] capitalize text-ink-muted">{merchant.reviewState.replaceAll("_", " ")}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        {canSeeActivity && (
          <details className="group overflow-hidden rounded-card border border-border bg-surface">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-ink marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5">
              <ScrollText className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <span className="flex-1">Administrative activity</span>
              <span className="text-xs font-normal text-ink-muted">{activity.length} recent</span>
              <ArrowRight className="h-4 w-4 rotate-90 text-ink-muted transition-transform group-open:-rotate-90" aria-hidden="true" />
            </summary>
            <div className="border-t border-border">
              {activity.length === 0 ? (
                <EmptyState icon={ScrollText} message="No recent administrative activity." className="border-0" />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((entry) => (
                    <li key={entry.id} className="px-4 py-3 text-sm sm:px-5">
                      <span className="font-medium text-ink">{entry.admin_users?.name ?? entry.admin_users?.email ?? "System"}</span>{" "}
                      <span className="text-ink-muted">{entry.action.replace(/_/g, " ")}</span>
                      {entry.target_type && <span className="text-ink-muted"> · {entry.target_type}</span>}
                      <span className="block text-xs text-ink-muted">{formatDateTime(entry.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
