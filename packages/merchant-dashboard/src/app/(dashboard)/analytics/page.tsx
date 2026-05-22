import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";

async function getAnalytics(partnerId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [allRes, recentRes] = await Promise.all([
    supabase.from("merchant_transactions").select("status,city,item_name,voucher_code").eq("partner_id", partnerId),
    supabase.from("merchant_transactions").select("status,city,item_name,voucher_code,created_at").eq("partner_id", partnerId).gte("created_at", thirtyDaysAgo),
  ]);

  const all = allRes.data ?? [];
  const recent = recentRes.data ?? [];

  const cityMap: Record<string, number> = {};
  for (const o of all) { const c = o.city ?? "Unknown"; cityMap[c] = (cityMap[c] ?? 0) + 1; }
  const by_city = Object.entries(cityMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const productMap: Record<string, number> = {};
  for (const o of all) { const n = o.item_name ?? "Unknown"; productMap[n] = (productMap[n] ?? 0) + 1; }
  const top_products = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const total = all.length;
  const with_voucher = all.filter((o) => o.voucher_code).length;
  const accepted = all.filter((o) => ["accepted","packed","out_for_delivery","delivered","received","completed"].includes(o.status)).length;
  const cancelled = all.filter((o) => o.status === "cancelled").length;

  const dayMap: Record<string, number> = {};
  for (const o of recent) { const d = o.created_at.slice(0, 10); dayMap[d] = (dayMap[d] ?? 0) + 1; }
  const daily_trend = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));

  return { total, with_voucher, accepted, cancelled, by_city, top_products, daily_trend };
}

export default async function AnalyticsPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const data = await getAnalytics(session.partnerId);
  const acceptance_rate = data.total > 0 ? Math.round((data.accepted / data.total) * 100) : 0;
  const cancellation_rate = data.total > 0 ? Math.round((data.cancelled / data.total) * 100) : 0;
  const voucher_rate = data.total > 0 ? Math.round((data.with_voucher / data.total) * 100) : 0;
  const maxDay = data.daily_trend.reduce((m, [, c]) => Math.max(m, c), 1);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Analytics" subtitle="Performance overview" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Total Orders", value: data.total },
            { label: "Acceptance Rate", value: `${acceptance_rate}%` },
            { label: "Cancellation Rate", value: `${cancellation_rate}%` },
            { label: "Voucher Usage", value: `${voucher_rate}%` },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="pt-5">
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 30-day trend */}
          <Card>
            <CardHeader><CardTitle>30-Day Order Trend</CardTitle></CardHeader>
            <CardContent>
              {data.daily_trend.length === 0 ? (
                <p className="text-sm text-gray-500">No data yet.</p>
              ) : (
                <div className="flex items-end gap-1 h-32">
                  {data.daily_trend.map(([date, count]) => (
                    <div key={date} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-[#238D9D] min-h-[4px]"
                        style={{ height: `${Math.round((count / maxDay) * 112)}px` }}
                        title={`${date}: ${count}`}
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">Last 30 days</p>
            </CardContent>
          </Card>

          {/* Top products */}
          <Card>
            <CardHeader><CardTitle>Top Products</CardTitle></CardHeader>
            <CardContent>
              {data.top_products.length === 0 ? (
                <p className="text-sm text-gray-500">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.top_products.map(([name, count]) => {
                    const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0;
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{name}</span>
                        <div className="w-20 overflow-hidden rounded-full bg-gray-100 h-2">
                          <div className="h-2 rounded-full bg-[#238D9D]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 text-right text-sm font-medium text-gray-700">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Orders by city */}
          <Card>
            <CardHeader><CardTitle>Orders by City</CardTitle></CardHeader>
            <CardContent>
              {data.by_city.length === 0 ? (
                <p className="text-sm text-gray-500">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.by_city.map(([city, count]) => {
                    const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0;
                    return (
                      <div key={city} className="flex items-center gap-3">
                        <span className="w-24 truncate text-sm text-gray-700">{city}</span>
                        <div className="flex-1 overflow-hidden rounded-full bg-gray-100 h-2">
                          <div className="h-2 rounded-full bg-[#238D9D]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 text-right text-sm font-medium text-gray-700">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Voucher stats */}
          <Card>
            <CardHeader><CardTitle>Voucher Usage</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Orders with voucher</span>
                <span className="font-medium">{data.with_voucher}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Orders without voucher</span>
                <span className="font-medium">{data.total - data.with_voucher}</span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className="h-3 rounded-full bg-[#238D9D]" style={{ width: `${voucher_rate}%` }} />
              </div>
              <p className="text-xs text-gray-400">{voucher_rate}% of orders used a voucher</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
