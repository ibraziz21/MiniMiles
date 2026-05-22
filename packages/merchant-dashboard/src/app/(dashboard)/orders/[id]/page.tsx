import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { OrderActionButton } from "@/components/orders/OrderActionButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import type { MerchantOrder } from "@/types";
import { ArrowLeft } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getOrder(orderId: string, partnerId: string): Promise<MerchantOrder | null> {
  const { data, error } = await supabase
    .from("merchant_transactions")
    .select("*")
    .eq("id", orderId)
    .eq("partner_id", partnerId) // enforce merchant isolation
    .single();

  if (error || !data) return null;
  return data as MerchantOrder;
}

export default async function OrderDetailPage({ params }: PageProps) {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const order = await getOrder(id, session.partnerId);
  if (!order) notFound();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title={`Order ${order.id.slice(0, 8)}…`}
        subtitle={formatDate(order.created_at)}
        actions={
          <Link
            href="/orders"
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Orders
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column — order details */}
          <div className="space-y-6 lg:col-span-2">
            {/* Status + header */}
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-mono mb-1">{order.id}</p>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-gray-900">
                      {order.amount_cusd != null
                        ? `${order.amount_cusd} ${order.payment_currency ?? "cUSD"}`
                        : "—"}
                    </p>
                    {order.amount_kes != null && (
                      <p className="text-sm text-gray-500">≈ KES {order.amount_kes}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Item details */}
            <Card>
              <CardHeader>
                <CardTitle>Item Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <DetailRow label="Item" value={order.item_name} />
                  <DetailRow label="Category" value={order.item_category} />
                  <DetailRow label="Payment Ref" value={order.payment_ref} mono />
                  <DetailRow label="Currency" value={order.payment_currency} />
                  {order.voucher_code && (
                    <DetailRow label="Voucher" value={order.voucher_code} mono />
                  )}
                </dl>
              </CardContent>
            </Card>

            {/* Customer delivery details */}
            <Card>
              <CardHeader>
                <CardTitle>Delivery Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <DetailRow label="Recipient" value={order.recipient_name} />
                  <DetailRow label="Phone" value={order.phone} />
                  <DetailRow label="City" value={order.city} />
                  <DetailRow label="Address" value={order.location_details} />
                </dl>
              </CardContent>
            </Card>

            {/* Customer wallet */}
            <Card>
              <CardHeader>
                <CardTitle>Customer</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-sm text-gray-700 break-all">{order.user_address}</p>
              </CardContent>
            </Card>
          </div>

          {/* Right column — timeline + actions */}
          <div className="space-y-6">
            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <OrderActionButton orderId={order.id} currentStatus={order.status} />
              </CardContent>
            </Card>

            {/* Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <OrderTimeline order={order} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-gray-900 ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
