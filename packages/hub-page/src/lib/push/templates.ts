export type PushCategory = "orders" | "refunds" | "vouchers";

export interface RenderedNotification {
  title: string;
  body: string;
}

// Copy is intentionally short -- it appears on lock screens (spec §11). Do
// not interpolate order/voucher metadata into title or body.
const TEMPLATES: Record<string, RenderedNotification> = {
  order_placed: { title: "Order received", body: "We've received your Akiba order." },
  order_accepted: { title: "Order accepted", body: "The merchant has accepted your order." },
  order_dispatched: { title: "Order on the way", body: "Your order has been dispatched." },
  order_delivered: { title: "Order delivered", body: "Confirm receipt when you have your order." },
  digital_delivered: { title: "Digital order ready", body: "Your digital order has been fulfilled." },
  order_cancelled: { title: "Order cancelled", body: "Open Akiba to see the order and refund status." },
  refund_initiated: { title: "Refund started", body: "Your refund is being processed." },
  refund_completed: { title: "Refund completed", body: "Your refund has been completed." },
  voucher_ready: { title: "Your voucher is ready", body: "Open Akiba to show its QR code." },
  voucher_failed: { title: "Voucher purchase not completed", body: "You were not charged. Open Akiba for details." },
  voucher_reconciliation: {
    title: "Voucher purchase needs review",
    body: "Your Miles are protected while we verify the transaction.",
  },
};

export function renderTemplate(template: string): RenderedNotification | null {
  return TEMPLATES[template] ?? null;
}
