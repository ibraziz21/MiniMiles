"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Spinner, Storefront, Receipt } from "@phosphor-icons/react";
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
  created_at: string | null;
  completed_at: string | null;
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
  if (!value) return "Pending";
  try {
    return new Intl.DateTimeFormat("en-KE", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
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
      .then((body) => {
        if (!cancelled) setOrders(body.orders ?? []);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, address]);

  const hasOrders = useMemo(() => orders.length > 0, [orders]);

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
              <p className="text-sm text-gray-500">Recent spend orders and payment references.</p>
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
            <p className="mt-1 text-sm text-gray-500">When you place a spend order, it will show up here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {order.partner?.name ?? "Merchant order"}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      {prettyVoucher(order.voucher)} · {order.category ?? "general"}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#238D9D0D] px-2.5 py-1 text-xs font-semibold capitalize text-[#238D9D]">
                    {order.status ?? "pending"}
                  </span>
                </div>

                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <Receipt size={15} className="text-[#238D9D]" />
                      Paid
                    </span>
                    <span className="font-medium text-gray-900">
                      KES {formatCurrency(order.amount_paid_kes)}
                      {order.payment_currency ? ` · ${order.payment_currency}` : ""}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <Storefront size={15} className="text-[#238D9D]" />
                      Ordered
                    </span>
                    <span className="text-right">{formatDate(order.created_at)}</span>
                  </div>

                  {order.completed_at && (
                    <div className="flex items-center justify-between gap-3">
                      <span>Completed</span>
                      <span className="text-right">{formatDate(order.completed_at)}</span>
                    </div>
                  )}

                  {order.payment_ref && (
                    <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      Payment ref: <span className="font-mono text-gray-700">{order.payment_ref}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
