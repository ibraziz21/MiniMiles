import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import {
  Users,
  Wallet,
  Coins,
  Store,
  ShoppingBag,
  Tag,
  BarChart2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type { OverviewStats } from "@/types";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const AlertTriangleIcon = AlertTriangle as unknown as IconComponent;

async function getOverviewStats(): Promise<OverviewStats> {
  const [usersRes, activeWalletsRes, milesRes, merchantsRes, ordersRes, vouchersRes, pollRes, incidentsRes] =
    await Promise.all([
      supabase.from("akiba_users").select("id", { count: "exact", head: true }),
      supabase
        .from("merchant_transactions")
        .select("user_address", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      supabase.from("miles_ledger").select("type, amount").in("type", ["mint", "burn"]),
      supabase.from("partners").select("id", { count: "exact", head: true }),
      supabase
        .from("merchant_transactions")
        .select("id", { count: "exact", head: true })
        .not("status", "in", '("received","completed","cancelled")'),
      supabase.from("issued_vouchers").select("status"),
      supabase.from("poll_responses").select("id", { count: "exact", head: true }),
      supabase
        .from("ops_incidents")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "in_progress"]),
    ]);

  let milesMinted = 0;
  let milesBurned = 0;
  for (const row of milesRes.data ?? []) {
    if (row.type === "mint") milesMinted += row.amount ?? 0;
    if (row.type === "burn") milesBurned += row.amount ?? 0;
  }

  const voucherRows = vouchersRes.data ?? [];
  return {
    total_users: usersRes.count ?? 0,
    active_wallets: activeWalletsRes.count ?? 0,
    miles_minted: milesMinted,
    miles_burned: milesBurned,
    miles_outstanding: milesMinted - milesBurned,
    total_merchants: merchantsRes.count ?? 0,
    active_orders: ordersRes.count ?? 0,
    vouchers_issued: voucherRows.length,
    vouchers_redeemed: voucherRows.filter((v) => v.status === "redeemed").length,
    poll_response_count: pollRes.count ?? 0,
    open_incidents: incidentsRes.count ?? 0,
  };
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  alert?: boolean;
}

function StatCard({ title, value, icon: Icon, sub, alert }: StatCardProps) {
  return (
    <Card className={alert ? "border-amber-200 bg-amber-50/50" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-500">{title}</CardTitle>
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${alert ? "bg-amber-100" : "bg-[#238D9D]/10"}`}>
            <Icon className={`h-4 w-4 ${alert ? "text-amber-600" : "text-[#238D9D]"}`} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-slate-900">{typeof value === "number" ? formatNumber(value) : value}</p>
        {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const stats = await getOverviewStats();

  return (
    <div>
      <TopBar title="Overview" subtitle="Platform health at a glance" />

      <div className="p-6 space-y-6">
        {stats.open_incidents > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangleIcon className="h-4 w-4 shrink-0" />
            <span>
              <strong>{stats.open_incidents}</strong> open ops incident{stats.open_incidents !== 1 ? "s" : ""} require attention.{" "}
              <a href="/ops-queue" className="underline font-medium">View queue →</a>
            </span>
          </div>
        )}

        {/* Users & wallets */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Users</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard title="Total Users" value={stats.total_users} icon={Users} />
            <StatCard title="Active Wallets (30d)" value={stats.active_wallets} icon={Wallet} sub="Wallets with ≥1 tx in last 30 days" />
            <StatCard title="Poll Responses" value={stats.poll_response_count} icon={BarChart2} />
          </div>
        </section>

        {/* AkibaMiles supply */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">AkibaMiles Supply</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Miles Minted" value={stats.miles_minted} icon={TrendingUp} />
            <StatCard title="Miles Burned" value={stats.miles_burned} icon={TrendingDown} />
            <StatCard title="Outstanding" value={stats.miles_outstanding} icon={Coins} sub="Minted minus burned" />
          </div>
        </section>

        {/* Commerce */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Commerce</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total Merchants" value={stats.total_merchants} icon={Store} />
            <StatCard title="Active Orders" value={stats.active_orders} icon={ShoppingBag} sub="Non-final status" />
            <StatCard title="Vouchers Issued" value={stats.vouchers_issued} icon={Tag} />
            <StatCard title="Vouchers Redeemed" value={stats.vouchers_redeemed} icon={Tag} sub={`${stats.vouchers_issued > 0 ? Math.round((stats.vouchers_redeemed / stats.vouchers_issued) * 100) : 0}% redemption rate`} />
          </div>
        </section>

        {/* Alerts */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Operational</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              title="Open Incidents"
              value={stats.open_incidents}
              icon={AlertTriangle}
              alert={stats.open_incidents > 0}
              sub={stats.open_incidents > 0 ? "Action required" : "All clear"}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
