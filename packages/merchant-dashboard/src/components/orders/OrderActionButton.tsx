"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { VALID_TRANSITIONS, FINAL_STATES } from "@/types";
import type { OrderStatus, MerchantActionStatus } from "@/types";
import { statusLabel } from "@/lib/utils";

const ACTION_LABELS: Record<MerchantActionStatus, string> = {
  accepted: "Accept Order",
  packed: "Mark as Packed",
  out_for_delivery: "Mark Dispatched",
  delivered: "Mark Delivered",
  cancelled: "Cancel Order",
};

const ACTION_VARIANT: Record<MerchantActionStatus, "default" | "destructive" | "outline"> = {
  accepted: "default",
  packed: "default",
  out_for_delivery: "default",
  delivered: "default",
  cancelled: "destructive",
};

interface Props {
  orderId: string;
  currentStatus: OrderStatus;
}

export function OrderActionButton({ orderId, currentStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<MerchantActionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (FINAL_STATES.has(currentStatus)) {
    return null;
  }

  const actions = (VALID_TRANSITIONS[currentStatus] ?? []) as MerchantActionStatus[];

  async function handleAction(action: MerchantActionStatus) {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/merchant/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update order");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <Button
          key={action}
          variant={ACTION_VARIANT[action]}
          className="w-full"
          disabled={loading !== null}
          onClick={() => handleAction(action)}
        >
          {loading === action ? "Updating…" : ACTION_LABELS[action]}
        </Button>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
