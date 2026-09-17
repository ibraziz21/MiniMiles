/**
 * Read-only Safaricom Daraja helper retained solely to reconcile STK pushes
 * that were already pending when direct commerce was retired. This module
 * cannot initiate a new consumer payment.
 */

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY    ?? "";
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET ?? "";
const SHORTCODE       = process.env.MPESA_SHORTCODE       ?? "";
const PASSKEY         = process.env.MPESA_PASSKEY         ?? "";
const BASE_URL        = process.env.MPESA_ENV === "sandbox"
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

export function isMpesaConfigured(): boolean {
  return !!(CONSUMER_KEY && CONSUMER_SECRET && SHORTCODE && PASSKEY);
}

async function getOAuthToken(): Promise<string> {
  const encoded = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${encoded}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const { access_token } = await res.json();
  return access_token as string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function password(ts: string): string {
  return Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString("base64");
}

export type StkQueryResult =
  | { status: "pending" }
  | { status: "success"; receiptNumber: string; amount: number; phone: string }
  | { status: "failed"; reason: string };

/**
 * Query the status of an STK push using the CheckoutRequestID.
 */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  const token = await getOAuthToken();
  const ts    = timestamp();
  const pwd   = password(ts);

  const res = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: SHORTCODE,
      Password: pwd,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // "The transaction is being processed" — still pending
    if ((err as { errorCode?: string })?.errorCode === "500.001.1001") return { status: "pending" };
    throw new Error(`STK query failed: ${res.status}`);
  }

  const data = await res.json();

  if (data.ResultCode === "0") {
    // Extract receipt from CallbackMetadata items
    const items: Array<{ Name: string; Value: unknown }> = data.CallbackMetadata?.Item ?? [];
    const get = (name: string) => items.find((i) => i.Name === name)?.Value;

    return {
      status: "success",
      receiptNumber: String(get("MpesaReceiptNumber") ?? ""),
      amount: Number(get("Amount") ?? 0),
      phone: String(get("PhoneNumber") ?? ""),
    };
  }

  if (data.ResultCode === "1032" || data.ResultCode === "1037") {
    return { status: "failed", reason: "Request cancelled or timed out" };
  }

  // Still processing (no result yet)
  return { status: "pending" };
}
