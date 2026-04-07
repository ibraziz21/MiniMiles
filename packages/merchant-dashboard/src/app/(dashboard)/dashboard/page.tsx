import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import type { OrderStatus, MerchantOrder } from "@/types";
import { ORDER_STATUSES } from "@/types";
import { ShoppingBag, Clock, TrendingUp, AlertCircle } from "lucide-react";

async function getStats(partnerId: string) {
  const [countRes, recentRes] = await Promise.all([
    supabase
      .from("merchant_transactions")
      .select("status")
      .eq("partner_id", partnerId),
    supabase
      .from("merchant_transactions")
      .select(
        "id,status,item_name,recipient_name,city,created_at,amount_cusd,payment_currency",
      )
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const by_status = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
    OrderStatus,
    number
  >;
  for (const row of countRes.data ?? []) {
    const s = row.status as OrderStatus;
    if (s in by_status) by_status[s]++;
  }

  return {
    new_orders: by_status.placed,
    total: (countRes.data ?? []).length,
    by_status,
    recent: (recentRes.data ?? []) as MerchantOrder[],
  };
}

const STAT_CARDS = [
  {
    key: "placed" as OrderStatus,
    label: "New Orders",
    icon: AlertCircle,
    color: "text-yellow-600",
    bg: "bg-yellow-50",
  },
  {
    key: "accepted" as OrderStatus,
    label: "Accepted",
    icon: Clock,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    key: "out_for_delivery" as OrderStatus,
    label: "In Transit",
    icon: TrendingUp,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    key: "completed" as OrderStatus,
    label: "Completed",
    icon: ShoppingBag,
    color: "text-green-600",
    bg: "bg-green-50",
  },
];

export default async function DashboardPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const stats = await getStats(session.partnerId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Dashboard"
        subtitle={`Welcome back — ${stats.new_orders} new order${stats.new_orders !== 1 ? "s" : ""} waiting`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STAT_CARDS.map(({ key, label, icon: Icon, color, bg }) => (
            <Card key={key}>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{stats.by_status[key]}</p>
                    <p className="text-xs text-gray-500">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Status breakdown */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Orders by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {ORDER_STATUSES.map((status) => {
                  const count = stats.by_status[status];
                  const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <StatusBadge status={status} />
                      <div className="flex-1 overflow-hidden rounded-full bg-gray-100 h-2">
                        <div
                          className="h-2 rounded-full bg-[#238D9D] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-sm font-medium text-gray-700">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Recent orders */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Orders</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {stats.recent.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-gray-500">No orders yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {stats.recent.map((order) => (
                    <li key={order.id}>
                      <Link
                        href={`/orders/${order.id}`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {order.item_name ?? "Order"}
                          </p>
                          <p className="text-xs text-gray-500">
                            {order.recipient_name} · {order.city} · {formatDate(order.created_at)}
                          </p>
                        </div>
                        <StatusBadge status={order.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {stats.recent.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100">
                  <Link href="/orders" className="text-sm font-medium text-[#238D9D] hover:underline">
                    View all orders →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
