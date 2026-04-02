"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Package, Spinner, Storefront, Receipt,
  CheckCircle, Truck, Archive, XCircle,
} from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { useWeb3 } from "@/contexts/useWeb3";

type OrderRecord = {
  id: string;
  status: string | null;
  category: string | null;
  voucher: string | null;
  amount_paid_kes: number;
  amount_paid_cusd: number;
  payment_currency: string | null;
  payment_ref: string | null;
  city: string | null;
  // Lifecycle timestamps
  created_at:    string | null;
  accepted_at:   string | null;
  packed_at:     string | null;
  dispatched_at: string | null;
  delivered_at:  string | null;
  received_at:   string | null;
  cancelled_at:  string | null;
  completed_at:  string | null;
  // Reward
  miles_reward_status: string | null;
  partner: {
    id: string;
    name: string;
    slug: string;
    image_url?: string | null;
  } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatDate(value: string | null) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("en-KE", {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function prettyVoucher(value: string | null) {
  if (!value) return "Order placed";
  return value.replaceAll("_", " ");
}

type TimelineStep = {
  label: string;
  ts: string | null;
  icon: React.ReactNode;
  isCancel?: boolean;
};

function buildTimeline(order: OrderRecord): TimelineStep[] {
  if (order.cancelled_at) {
    return [
      { label: "Order placed",  ts: order.created_at,   icon: <Receipt size={14} /> },
      { label: "Cancelled",     ts: order.cancelled_at, icon: <XCircle size={14} />, isCancel: true },
    ];
  }
  return [
    { label: "Order placed",    ts: order.created_at,    icon: <Receipt size={14} /> },
    { label: "Accepted",        ts: order.accepted_at,   icon: <Storefront size={14} /> },
    { label: "Packed",          ts: order.packed_at,     icon: <Archive size={14} /> },
    { label: "Out for delivery",ts: order.dispatched_at, icon: <Truck size={14} /> },
    { label: "Delivered",       ts: order.delivered_at,  icon: <Package size={14} /> },
    { label: "Received",        ts: order.received_at,   icon: <CheckCircle size={14} /> },
  ];
}

const STATUS_LABEL: Record<string, string> = {
  placed:          "Placed",
  accepted:        "Accepted",
  packed:          "Packed",
  out_for_delivery:"Out for delivery",
  delivered:       "Delivered",
  received:        "Received",
  completed:       "Completed",
  cancelled:       "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  placed:          "bg-gray-100 text-gray-600",
  accepted:        "bg-blue-50 text-blue-600",
  packed:          "bg-purple-50 text-purple-600",
  out_for_delivery:"bg-amber-50 text-amber-600",
  delivered:       "bg-teal-50 text-[#238D9D]",
  received:        "bg-green-50 text-green-600",
  completed:       "bg-green-50 text-green-700",
  cancelled:       "bg-red-50 text-red-500",
};

function OrderCard({
  order,
  onConfirmed,
}: {
  order: OrderRecord;
  onConfirmed: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const timeline = useMemo(() => buildTimeline(order), [order]);
  const doneSteps = timeline.filter((s) => s.ts !== null);
  const status = order.status ?? "placed";

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/Spend/orders/${order.id}/confirm-received`, {
        method: "POST",
      });
      if (res.ok) onConfirmed(order.id);
    } catch {
      // silent — user can retry
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {order.partner?.name ?? "Merchant order"}
          </p>
          <p className="text-xs uppercase tracking-wide text-gray-400">
            {prettyVoucher(order.voucher)} · {order.category ?? "general"}
            {order.city ? ` · ${order.city}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_COLOR[status] ?? "bg-gray-100 text-gray-600"}`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Amount */}
      <div className="mb-3 flex items-center justify-between text-sm text-gray-600">
        <span className="flex items-center gap-2">
          <Receipt size={15} className="text-[#238D9D]" />
          Paid
        </span>
        <span className="font-medium text-gray-900">
          KES {formatCurrency(order.amount_paid_kes)}
          {order.payment_currency ? ` · ${order.payment_currency}` : ""}
        </span>
      </div>

      {/* Timeline */}
      <div className="mt-3 border-t border-gray-50 pt-3">
        <div className="space-y-2">
          {timeline.map((step, i) => {
            const done = step.ts !== null;
            const isLast = i === doneSteps.length - 1 && done;
            return (
              <div key={step.label} className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${
                    done
                      ? step.isCancel
                        ? "bg-red-100 text-red-500"
                        : isLast
                        ? "bg-[#238D9D] text-white"
                        : "bg-green-100 text-green-600"
                      : "bg-gray-100 text-gray-300"
                  }`}
                >
                  {step.icon}
                </div>
                <div className="flex flex-1 items-baseline justify-between gap-2">
                  <span
                    className={`text-xs font-medium ${
                      done ? (step.isCancel ? "text-red-500" : "text-gray-800") : "text-gray-300"
                    }`}
                  >
                    {step.label}
                  </span>
                  {done && step.ts && (
                    <span className="text-right text-[10px] text-gray-400">
                      {formatDate(step.ts)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirm received button — only shown when delivered */}
      {status === "delivered" && (
        <button
          type="button"
          disabled={confirming}
          onClick={handleConfirm}
          className="mt-4 flex h-11 w-full items-center justify-center rounded-[14px] bg-[#238D9D] text-sm font-medium text-white disabled:opacity-60"
        >
          {confirming ? (
            <Spinner size={16} className="animate-spin" />
          ) : (
            "Confirm received · Earn 200 AkibaMiles"
          )}
        </button>
      )}

      {/* Reward indicator */}
      {(status === "received" || status === "completed") && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">
          <CheckCircle size={14} weight="fill" />
          {order.miles_reward_status === "sent"
            ? "+200 AkibaMiles minted"
            : "+200 AkibaMiles queued — arriving shortly"}
        </div>
      )}

      {/* Payment ref */}
      {order.payment_ref && (
        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
          Ref: <span className="font-mono text-gray-700">{order.payment_ref.slice(0, 20)}…</span>
        </div>
      )}
    </div>
  );
}

export default function OrderTrackingSheet({ open, onOpenChange }: Props) {
  const { address } = useWeb3();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !address) return;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/Spend/orders/user/${address.toLowerCase()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((body) => { if (!cancelled) setOrders(body.orders ?? []); })
      .catch(() => { if (!cancelled) setOrders([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, address]);

  function handleConfirmed(orderId: string) {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, status: "completed", received_at: new Date().toISOString(), completed_at: new Date().toISOString() }
          : o,
      ),
    );
  }

  const hasOrders = orders.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-2xl font-sterling max-h-[88vh] overflow-auto p-4 pb-8"
      >
        <SheetHeader>
          <SheetTitle className="sr-only">Track orders</SheetTitle>
        </SheetHeader>

        <div className="mb-5 pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#238D9D0D]">
              <Package size={22} className="text-[#238D9D]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Track your orders</h2>
              <p className="text-sm text-gray-500">Live status and delivery timeline.</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size={28} className="animate-spin text-[#238D9D]" />
          </div>
        ) : !address ? (
          <div className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
            Connect your wallet to view orders.
          </div>
        ) : !hasOrders ? (
          <div className="rounded-2xl bg-gray-50 px-4 py-8 text-center">
            <p className="text-sm font-medium text-gray-700">No orders yet</p>
            <p className="mt-1 text-sm text-gray-500">
              When you place a spend order, it will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onConfirmed={handleConfirmed} />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
