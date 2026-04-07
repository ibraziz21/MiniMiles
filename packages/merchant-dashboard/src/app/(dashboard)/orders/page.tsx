import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { formatDate, statusLabel } from "@/lib/utils";
import Link from "next/link";
import type { MerchantOrder, OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

async function getOrders(
  partnerId: string,
  statusFilter: OrderStatus | null,
  page: number,
) {
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("merchant_transactions")
    .select(
      `id,status,item_name,item_category,recipient_name,phone,city,
       created_at,accepted_at,delivered_at,cancelled_at,
       amount_cusd,payment_currency,voucher_code`,
      { count: "exact" },
    )
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { orders: (data ?? []) as MerchantOrder[], total: count ?? 0 };
}

export default async function OrdersPage({ searchParams }: PageProps) {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const rawStatus = params.status as OrderStatus | undefined;
  const statusFilter: OrderStatus | null =
    rawStatus && ORDER_STATUSES.includes(rawStatus) ? rawStatus : null;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));

  const { orders, total } = await getOrders(session.partnerId, statusFilter, page);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Orders"
        subtitle={`${total} order${total !== 1 ? "s" : ""}${statusFilter ? ` · ${statusLabel(statusFilter)}` : ""}`}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Status filter tabs */}
        <div className="border-b border-gray-200 bg-white px-6">
          <div className="flex gap-1 overflow-x-auto py-2">
            <FilterTab href="/orders" active={!statusFilter} label="All" />
            {ORDER_STATUSES.map((s) => (
              <FilterTab
                key={s}
                href={`/orders?status=${s}`}
                active={statusFilter === s}
                label={statusLabel(s)}
              />
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="p-6">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 py-16 text-center">
              <p className="text-sm text-gray-500">No orders found.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">Order</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Item</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Amount</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Placed</th>
                    <th className="px-4 py-3 font-medium text-gray-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {order.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{order.recipient_name ?? "—"}</p>
                        <p className="text-xs text-gray-500">{order.city}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{order.item_name ?? "—"}</p>
                        {order.item_category && (
                          <p className="text-xs text-gray-500">{order.item_category}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {order.amount_cusd != null
                          ? `${order.amount_cusd} ${order.payment_currency ?? "cUSD"}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/orders/${order.id}`}
                          className="text-[#238D9D] hover:underline font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                  <p className="text-sm text-gray-500">
                    Page {page} of {totalPages} · {total} total
                  </p>
                  <div className="flex gap-2">
                    {page > 1 && (
                      <Link
                        href={`/orders?${statusFilter ? `status=${statusFilter}&` : ""}page=${page - 1}`}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                      >
                        Previous
                      </Link>
                    )}
                    {page < totalPages && (
                      <Link
                        href={`/orders?${statusFilter ? `status=${statusFilter}&` : ""}page=${page + 1}`}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                      >
                        Next
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-[#238D9D] text-white"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
      )}
    >
      {label}
    </Link>
  );
}
