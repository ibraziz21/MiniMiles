export type PushCategory = "orders" | "refunds" | "vouchers" | "rewards" | "marketing" | "earnings";

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

  if (template === "miles_earned") {
    return renderMilesEarned(metadata);
  }

  return TEMPLATES[template] ?? null;
}

// miles_earned copy states (§6.5) — built purely from the metadata snapshot
// captured at notification-creation time (§6.4), never recomputed here.
// Lock-screen safe: no purchase amount, products, receipt, or identity data.
function renderMilesEarned(metadata: Record<string, unknown>): RenderedNotification {
  const amountMiles = typeof metadata.amountMiles === "number" && Number.isFinite(metadata.amountMiles)
    ? metadata.amountMiles
    : 0;
  const merchantName = typeof metadata.merchantName === "string" && metadata.merchantName.trim()
    ? metadata.merchantName.trim()
    : "an Akiba merchant";
  const amountLabel = amountMiles.toLocaleString("en-KE");

  const nextReward = metadata.nextReward as
    | { benefitLabel?: unknown; merchantName?: unknown; gapMiles?: unknown; affordable?: unknown }
    | null
    | undefined;

  if (nextReward && nextReward.affordable === true) {
    const benefitLabel = typeof nextReward.benefitLabel === "string" ? nextReward.benefitLabel : "a reward";
    const targetMerchant = typeof nextReward.merchantName === "string" ? nextReward.merchantName : "an Akiba merchant";
    return {
      title: "Reward unlocked 🎉",
      body: `Your ${amountLabel} Miles from ${merchantName} unlocked ${benefitLabel} at ${targetMerchant}.`,
    };
  }

  if (nextReward && typeof nextReward.gapMiles === "number" && Number.isFinite(nextReward.gapMiles)) {
    const benefitLabel = typeof nextReward.benefitLabel === "string" ? nextReward.benefitLabel : "your next reward";
    return {
      title: `You earned ${amountLabel} Miles 🎉`,
      body: `From ${merchantName}. Only ${nextReward.gapMiles.toLocaleString("en-KE")} more to unlock ${benefitLabel}.`,
    };
  }

  return {
    title: `You earned ${amountLabel} Miles 🎉`,
    body: `Your purchase at ${merchantName} added Miles to your balance.`,
  };
}
