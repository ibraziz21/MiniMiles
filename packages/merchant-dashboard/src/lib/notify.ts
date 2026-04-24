import { supabase } from "./supabase";
import type { NotificationType } from "@/types";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM ?? "noreply@minimiles.app";

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (!RESEND_API_KEY) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getActiveMerchantEmails(partnerId: string): Promise<string[]> {
  const { data: users } = await supabase
    .from("merchant_users")
    .select("email")
    .eq("partner_id", partnerId)
    .eq("is_active", true);

  return [...new Set((users ?? []).map((u) => u.email).filter(Boolean))];
}

export async function logNotification(params: {
  partnerId: string;
  type: NotificationType;
  orderId?: string;
  subject?: string;
  bodyPreview?: string;
}): Promise<void> {
  await supabase.from("merchant_notification_log").insert({
    partner_id: params.partnerId,
    type: params.type,
    order_id: params.orderId ?? null,
    subject: params.subject ?? null,
    body_preview: params.bodyPreview ?? null,
  });
}

export async function sendNewOrderEmail(params: {
  partnerId: string;
  partnerName: string;
  orderId: string;
  itemName: string;
  recipientName: string;
  city: string;
  amountCusd: number;
}): Promise<boolean> {
  const { partnerId, partnerName, orderId, itemName, recipientName, city, amountCusd } = params;

  const emails = await getActiveMerchantEmails(partnerId);
  if (emails.length === 0) return false;

  const dashboardUrl = process.env.MERCHANT_DASHBOARD_URL ?? "http://localhost:3001";
  const subject = `New order — ${itemName} | ${partnerName}`;
  const html = `
    <h2>New Order Received</h2>
    <p><strong>Item:</strong> ${itemName}</p>
    <p><strong>Recipient:</strong> ${recipientName}, ${city}</p>
    <p><strong>Amount:</strong> $${amountCusd} cUSD</p>
    <p><a href="${dashboardUrl}/orders/${orderId}">View Order →</a></p>
  `;

  const sent = await sendEmail({ to: emails, subject, html });
  if (!sent) return false;

  await logNotification({
    partnerId,
    type: "new_order",
    orderId,
    subject,
    bodyPreview: `New order: ${itemName} for ${recipientName}, ${city}`,
  });

  return true;
}

export async function sendStuckRewardEmail(params: {
  partnerId: string;
  partnerName: string;
  orderId: string;
  itemName: string;
  recipientName: string;
  hoursStuck: number;
}): Promise<boolean> {
  const { partnerId, partnerName, orderId, itemName, recipientName, hoursStuck } = params;

  const emails = await getActiveMerchantEmails(partnerId);
  if (emails.length === 0) return false;

  const dashboardUrl = process.env.MERCHANT_DASHBOARD_URL ?? "http://localhost:3001";
  const subject = `⚠️ Reward not sent — ${itemName} | ${partnerName}`;
  const html = `
    <h2>Order Reward Stuck</h2>
    <p>An order has been confirmed received but the AkibaMiles reward has not been sent after <strong>${hoursStuck} hours</strong>.</p>
    <p><strong>Item:</strong> ${itemName}</p>
    <p><strong>Recipient:</strong> ${recipientName}</p>
    <p>The reward worker will retry automatically. If this persists, check the mint job queue.</p>
    <p><a href="${dashboardUrl}/orders/${orderId}">View Order →</a></p>
  `;

  const sent = await sendEmail({ to: emails, subject, html });
  if (!sent) return false;

  await logNotification({
    partnerId,
    type: "stuck_reward",
    orderId,
    subject,
    bodyPreview: `Reward stuck (${hoursStuck}h): ${itemName} for ${recipientName}`,
  });

  return true;
}

export async function sendStaleOrderEmail(params: {
  partnerId: string;
  partnerName: string;
  orderId: string;
  itemName: string;
  recipientName: string;
  currentStatus: string;
  hoursSincePlaced: number;
}): Promise<boolean> {
  const { partnerId, partnerName, orderId, itemName, recipientName, currentStatus, hoursSincePlaced } = params;

  const emails = await getActiveMerchantEmails(partnerId);
  if (emails.length === 0) return false;

  const dashboardUrl = process.env.MERCHANT_DASHBOARD_URL ?? "http://localhost:3001";
  const subject = `⚠️ Stale order needs attention — ${itemName} | ${partnerName}`;
  const html = `
    <h2>Order Needs Attention</h2>
    <p>An order has been in status <strong>${currentStatus}</strong> for <strong>${hoursSincePlaced} hours</strong>.</p>
    <p><strong>Item:</strong> ${itemName}</p>
    <p><strong>Recipient:</strong> ${recipientName}</p>
    <p><a href="${dashboardUrl}/orders/${orderId}">View Order →</a></p>
  `;

  const sent = await sendEmail({ to: emails, subject, html });
  if (!sent) return false;

  await logNotification({
    partnerId,
    type: "stale_order",
    orderId,
    subject,
    bodyPreview: `Stale order (${hoursSincePlaced}h): ${itemName} for ${recipientName} — status: ${currentStatus}`,
  });

  return true;
}
