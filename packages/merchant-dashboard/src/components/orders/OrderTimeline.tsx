import { formatDate } from "@/lib/utils";
import type { MerchantOrder } from "@/types";
import { CheckCircle2, Circle } from "lucide-react";

interface TimelineStep {
  label: string;
  timestamp: string | null;
}

function getSteps(order: MerchantOrder): TimelineStep[] {
  const steps: TimelineStep[] = [
    { label: "Order Placed", timestamp: order.created_at },
    { label: "Accepted", timestamp: order.accepted_at },
    { label: "Packed", timestamp: order.packed_at },
    { label: "Out for Delivery", timestamp: order.dispatched_at },
    { label: "Delivered", timestamp: order.delivered_at },
    { label: "Received by Customer", timestamp: order.received_at },
  ];

  if (order.cancelled_at) {
    steps.push({ label: "Cancelled", timestamp: order.cancelled_at });
  }

  return steps;
}

export function OrderTimeline({ order }: { order: MerchantOrder }) {
  const steps = getSteps(order);
  const isCancelled = !!order.cancelled_at;

  return (
    <ol className="relative space-y-4 border-l border-gray-200 pl-6">
      {steps.map((step, i) => {
        const done = !!step.timestamp;
        const isCancelStep = step.label === "Cancelled";
        return (
          <li key={i} className="relative">
            <span
              className={`absolute -left-[1.65rem] flex h-6 w-6 items-center justify-center rounded-full ${
                isCancelStep && done
                  ? "bg-red-100 text-red-600"
                  : done
                  ? "bg-[#238D9D]/10 text-[#238D9D]"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </span>
            <div className={done ? "text-gray-900" : "text-gray-400"}>
              <p className="text-sm font-medium">{step.label}</p>
              {step.timestamp && (
                <p className="text-xs text-gray-500">{formatDate(step.timestamp)}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
