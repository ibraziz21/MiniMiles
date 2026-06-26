import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daraja STK push callback — receives the authoritative payment result from Safaricom.
 * Stored in mpesa_stk_results; the orders route verifies against this before accepting payment.
 *
 * This route is public (no auth) because Safaricom calls it directly.
 * The MPESA_CALLBACK_SECRET env var is used to authenticate the caller.
 */
export async function POST(req: NextRequest) {
  // Read at request time so tests can override process.env between calls.
  // MPESA_CALLBACK_SECRET must always be configured: an unset secret means we
  // cannot authenticate Safaricom — reject all callbacks to prevent a forged
  // request from producing trusted payment evidence.
  const CALLBACK_SECRET = process.env.MPESA_CALLBACK_SECRET ?? "";
  if (!CALLBACK_SECRET) {
    console.error("[mpesa/callback] MPESA_CALLBACK_SECRET is not configured — rejecting callback");
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Server misconfiguration" }, { status: 500 });
  }

  const provided = req.headers.get("x-mpesa-secret") ?? "";
  if (provided !== CALLBACK_SECRET) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
  }

  const stkCallback = (body?.Body as Record<string, unknown>)?.stkCallback as Record<string, unknown> | undefined;
  if (!stkCallback) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Missing stkCallback" }, { status: 400 });
  }

  const checkoutRequestId = stkCallback.CheckoutRequestID as string | undefined;
  const resultCode        = String(stkCallback.ResultCode ?? "");
  const metadata          = stkCallback.CallbackMetadata as { Item?: Array<{ Name: string; Value: unknown }> } | undefined;

  if (!checkoutRequestId) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Missing CheckoutRequestID" }, { status: 400 });
  }

  const items = metadata?.Item ?? [];
  const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;

  const admin = createAdminClient();

  const { error } = await admin.from("mpesa_stk_results").upsert(
    {
      checkout_request_id: checkoutRequestId,
      result_code:         resultCode,
      receipt_number:      getItem("MpesaReceiptNumber") != null ? String(getItem("MpesaReceiptNumber")) : null,
      amount_kes:          getItem("Amount") != null ? Number(getItem("Amount")) : null,
      phone:               getItem("PhoneNumber") != null ? String(getItem("PhoneNumber")) : null,
      raw:                 body,
    },
    { onConflict: "checkout_request_id" }
  );

  if (error) {
    console.error("[mpesa/callback] DB error — returning 500 so Daraja retries:", error);
    // Return 5xx so Safaricom retries the callback delivery.
    return NextResponse.json(
      { ResultCode: 1, ResultDesc: "Internal error — please retry" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
