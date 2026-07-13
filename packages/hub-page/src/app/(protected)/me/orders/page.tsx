import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppingBag, Clock, CheckCircle2, Truck, Package, ArrowLeft, Coins } from "lucide-react";
import { getPurchaseEventForOrder } from "@/lib/akiba/purchase-events";
import type { OrderRewardStatus } from "@/lib/akiba/purchase-events";

export const metadata = { title: "My Orders — Akiba Pass" };

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  placed: {
    label: "Order placed",
    color: "bg-blue-50 text-blue-700",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  accepted: {
    label: "Accepted",
    color: "bg-amber-50 text-amber-700",
    icon: <Package className="h-3.5 w-3.5" />,
  },
  packed: {
    label: "Packed",
    color: "bg-amber-50 text-amber-700",
    icon: <Package className="h-3.5 w-3.5" />,
  },
  out_for_delivery: {
    label: "Out for delivery",
    color: "bg-purple-50 text-purple-700",
    icon: <Truck className="h-3.5 w-3.5" />,
  },
  delivered: {
    label: "Delivered",
    color: "bg-green-50 text-green-700",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  received: {
    label: "Received",
    color: "bg-green-50 text-green-700",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  completed: {
    label: "Completed",
    color: "bg-akiba-tint text-akiba-teal",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-red-50 text-red-500",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
};

type Order = {
  id: string;
  status: string;
  item_name: string;
  item_category: string;
  amount_cusd: number;
  payment_currency: string;
  city: string;
  recipient_name: string;
  created_at: string;
  delivered_at: string | null;
  voucher_code: string | null;
  partners: { name: string; image_url: string | null } | null;
};

async function getOrders(userId: string): Promise<Order[]> {
  const admin = createAdminClient();

  const { data: wallet } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!wallet) return [];

  const { data } = await admin
    .from("merchant_transactions")
    .select(`
      id, status, item_name, item_category, amount_cusd,
      payment_currency, city, recipient_name, created_at,
      delivered_at, voucher_code,
      partners ( name, image_url )
    `)
    .eq("user_address", wallet.address)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []) as unknown as Order[];
}

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/me/orders");

  const orders = await getOrders(user.id);

  // Fetch Platform reward status for all orders in parallel.
  // Promise.allSettled ensures a Platform failure for one order never breaks the page.
  const rewardStatuses = await Promise.allSettled(
    orders.map((o) => getPurchaseEventForOrder(o.id))
  );

  const rewardByOrderId = new Map<string, OrderRewardStatus>(
    orders.map((o, i) => {
      const result = rewardStatuses[i];
      const status: OrderRewardStatus =
        result.status === "fulfilled" ? result.value : { state: "pending" };
      return [o.id, status];
    })
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <a href="/me" className="mb-6 flex items-center gap-1.5 text-sm text-akiba-muted hover:text-akiba-ink">
        <ArrowLeft className="h-4 w-4" /> My profile
      </a>

      <h1 className="mb-6 font-sterling text-2xl font-semibold text-akiba-ink">My Orders</h1>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
          <ShoppingBag className="mb-3 h-10 w-10 text-akiba-line" />
          <p className="font-medium text-akiba-ink">No orders yet</p>
          <p className="mt-1 text-sm text-akiba-muted">Head to the shop to make your first purchase.</p>
          <a
            href="/shop"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-akiba-teal px-5 py-2 text-sm font-semibold text-white"
          >
            <ShoppingBag className="h-4 w-4" /> Shop & Earn
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.placed;
            const partner = Array.isArray(order.partners) ? order.partners[0] : order.partners;
            const reward = rewardByOrderId.get(order.id) ?? { state: "pending" as const };

            return (
              <div
                key={order.id}
                className="rounded-2xl border border-akiba-line bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  {/* Merchant logo */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-akiba-card">
                    {partner?.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={partner.image_url} alt={partner.name} className="h-full w-full object-contain p-1" />
                    ) : (
                      <ShoppingBag className="h-5 w-5 text-akiba-muted" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-akiba-ink truncate">{order.item_name}</p>
                        <p className="text-sm text-akiba-muted">{partner?.name}</p>
                      </div>
                      <span className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-akiba-muted">
                      <span className="font-medium text-akiba-ink">
                        ${order.amount_cusd.toFixed(2)} {order.payment_currency}
                      </span>
                      <span className="capitalize">{order.city}</span>
                      <span>{new Date(order.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>

                    {order.voucher_code && (
                      <p className="mt-1 text-xs text-akiba-teal">
                        Voucher: {order.voucher_code}
                      </p>
                    )}

                    <RewardBadge reward={reward} />

                    {order.status === "delivered" && (
                      <ConfirmReceiptButton orderId={order.id} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function RewardBadge({ reward }: { reward: OrderRewardStatus }) {
  if (reward.state === "rewarded") {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-akiba-teal">
        <Coins className="h-3.5 w-3.5" />
        +{reward.miles} AkibaMiles
      </div>
    );
  }
  if (reward.state === "not_rewarded") {
    return (
      <p className="mt-2 text-xs text-akiba-muted">No reward issued</p>
    );
  }
  // pending / unavailable — show nothing rather than cluttering every card
  return null;
}

function ConfirmReceiptButton({ orderId }: { orderId: string }) {
  return (
    <form
      action={`/api/shop/orders/${orderId}/confirm`}
      method="POST"
    >
      <button
        type="submit"
        className="mt-3 w-full rounded-xl bg-akiba-teal py-2 text-xs font-semibold text-white transition hover:bg-[#1E7E8D]"
      >
        Confirm received
      </button>
    </form>
  );
}
