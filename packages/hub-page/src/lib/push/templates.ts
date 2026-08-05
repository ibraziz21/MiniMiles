export type PushCategory = "orders" | "refunds" | "vouchers" | "rewards" | "marketing";

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
  refund_failed: { title: "Refund needs attention", body: "Open Akiba to review your refund status." },
  voucher_ready: { title: "Your voucher is ready", body: "Open Akiba to show its QR code." },
  voucher_failed: { title: "Voucher purchase not completed", body: "You were not charged. Open Akiba for details." },
  voucher_reconciliation: {
    title: "Voucher purchase needs review",
    body: "Your Miles are protected while we verify the transaction.",
  },
  referral_manual_review: {
    title: "Reward under review",
    body: "A referral reward needs more time for review.",
  },
};

export function renderTemplate(
  template: string,
  metadata: Record<string, unknown> = {}
): RenderedNotification | null {
  if (["feature_announcement", "merchant_announcement", "general_announcement"].includes(template)) {
    const title = typeof metadata.title === "string" ? metadata.title.trim() : "";
    const body = typeof metadata.body === "string" ? metadata.body.trim() : "";
    if (!title || title.length > 60 || !body || body.length > 160) return null;
    return { title, body };
  }

  const configuredMiles = metadata.amountMiles;
  const miles = typeof configuredMiles === "number" && Number.isFinite(configuredMiles)
    ? configuredMiles
    : template.includes("activation") ? 100 : 50;

  if (template === "referral_signup_held") {
    return { title: "Friend joined!", body: `A friend joined with your invite. ${miles} Miles are pending.` };
  }
  if (template === "referral_signup_released") {
    return { title: "Miles earned", body: `You earned ${miles} Miles for a referral.` };
  }
  if (template === "referral_activation_held") {
    return { title: "Friend became active!", body: `Your friend became active. ${miles} Miles are pending.` };
  }
  if (template === "referral_activation_released") {
    return { title: "Referral complete!", body: `You earned another ${miles} Miles. Referral complete!` };
  }

  return TEMPLATES[template] ?? null;
}
