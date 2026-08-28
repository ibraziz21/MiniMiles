import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppingBag, Clock, CheckCircle2, Truck, Package, ArrowLeft, Coins } from "lucide-react";
import { getPurchaseEventForOrder } from "@/lib/akiba/purchase-events";
import type { OrderRewardStatus } from "@/lib/akiba/purchase-events";
import { ConfirmReceiptAction } from "./ConfirmReceiptAction";
import { RecoveryBanner } from "./RecoveryBanner";
import { getOwnedAddresses } from "@/lib/akiba/order-ownership";

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
  disputed: {
    label: "Under review",
    color: "bg-amber-50 text-amber-700",
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
  accepted_at: string | null;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  voucher_code: string | null;
  partners: { name: string; image_url: string | null } | null;
};

type Refund = {
  order_id: string;
  refund_status: "pending_manual" | "refunded" | "not_applicable";
  rail: "mpesa" | "crypto" | "miles" | null;
  refund_tx_hash: string | null;
};

async function getOrders(userId: string): Promise<{ orders: Order[]; refunds: Map<string, Refund> }> {
  const admin = createAdminClient();

  // Resolve ALL linked wallets, not just the first — an order can be placed
  // under any of them.
  const addresses = await getOwnedAddresses(admin, userId);

  if (addresses.length === 0) return { orders: [], refunds: new Map() };

  const { data } = await admin
    .from("merchant_transactions")
    .select(`
      id, status, item_name, item_category, amount_cusd,
      payment_currency, city, recipient_name, created_at,
      accepted_at, packed_at, dispatched_at, delivered_at,
      received_at, completed_at, cancelled_at, voucher_code,
      partners ( name, image_url )
    `)
    .in("user_address", addresses)
    .order("created_at", { ascending: false })
    .limit(50);

  const orders = (data ?? []) as unknown as Order[];
  const cancelledIds = orders.filter((o) => o.status === "cancelled").map((o) => o.id);

  const refunds = new Map<string, Refund>();
  if (cancelledIds.length > 0) {
    const { data: refundRows } = await admin
      .from("order_cancellation_compensations")
      .select("order_id, refund_status, rail, refund_tx_hash")
      .in("order_id", cancelledIds);
    for (const r of refundRows ?? []) {
      if (r.order_id) refunds.set(r.order_id, r as Refund);
    }
  }

  return { orders, refunds };
}

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/me/orders");

  const { orders, refunds } = await getOrders(user.id);

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

      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">My Orders</h1>
        <a href="/me/notifications" className="text-sm font-medium text-akiba-teal hover:underline">Notifications</a>
      </div>

      <RecoveryBanner />

      {orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
          <ShoppingBag className="mb-3 h-10 w-10 text-akiba-line" />
          <p className="font-medium text-akiba-ink">No orders yet</p>
          <p className="mt-1 text-sm text-akiba-muted">Head to the shop to make your first purchase.</p>
          <a
            href="/merchants"
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
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-akiba-ink break-words">{order.item_name}</p>
                        <p className="text-sm text-akiba-muted">{partner?.name}</p>
                      </div>
                      <span className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.color}`}>
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

                    {order.status === "cancelled" && (
                      <RefundStatus refund={refunds.get(order.id) ?? null} />
                    )}

                    <OrderTimeline order={order} />

                    {order.status === "delivered" && <ConfirmReceiptAction orderId={order.id} />}
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

function OrderTimeline({ order }: { order: Order }) {
  const steps: Array<{ label: string; timestamp: string | null }> = [
    { label: "Order placed", timestamp: order.created_at },
    { label: "Accepted", timestamp: order.accepted_at },
    { label: "Packed", timestamp: order.packed_at },
    { label: "Out for delivery", timestamp: order.dispatched_at },
    { label: "Delivered", timestamp: order.delivered_at },
    { label: "Received", timestamp: order.received_at },
    { label: "Completed", timestamp: order.completed_at },
  ];
  if (order.cancelled_at) steps.push({ label: "Cancelled", timestamp: order.cancelled_at });

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none text-akiba-muted hover:text-akiba-ink">Order timeline</summary>
      <ol className="mt-2 space-y-1.5 border-l border-akiba-line pl-3">
        {steps.map((step) => {
          const done = !!step.timestamp;
          return (
            <li key={step.label} className={done ? "text-akiba-ink" : "text-akiba-line"}>
              <span className="font-medium">{step.label}</span>
              {step.timestamp && (
                <span className="ml-2 text-akiba-muted">
                  {new Date(step.timestamp).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function RefundStatus({ refund }: { refund: Refund | null }) {
  if (!refund) return null;

  if (refund.refund_status === "pending_manual") {
    return (
      <p className="mt-2 text-xs text-amber-700">
        Refund initiated{refund.rail ? ` — ${refund.rail === "mpesa" ? "M-Pesa" : "crypto"}` : ""} — processing
      </p>
    );
  }
  if (refund.refund_status === "refunded") {
    return (
      <p className="mt-2 text-xs text-akiba-teal">
        Refund completed{refund.refund_tx_hash ? ` — ref ${refund.refund_tx_hash}` : ""}
      </p>
    );
  }
  return null;
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

