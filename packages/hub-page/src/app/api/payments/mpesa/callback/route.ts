import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daraja STK push callback — receives the authoritative payment result from Safaricom.
 * Stored in mpesa_stk_results; the orders route verifies against this before accepting payment.
 *
 * This route is public (no auth) because Safaricom calls it directly.
 * Production callbacks require the MPESA_CALLBACK_SECRET header injected by
 * the configured callback proxy. Daraja sandbox callbacks cannot add custom
 * headers, so sandbox instead accepts callbacks only for checkout IDs that this
 * server previously recorded in mpesa_stk_requests.
 */
export async function POST(req: NextRequest) {
  const isSandbox = process.env.MPESA_ENV === "sandbox";

  if (!isSandbox) {
    // Read at request time so tests can override process.env between calls.
    // Production keeps the strict shared-secret requirement; a callback proxy
    // must inject this header before forwarding Daraja's request.
    const callbackSecret = process.env.MPESA_CALLBACK_SECRET ?? "";
    if (!callbackSecret) {
      console.error("[mpesa/callback] MPESA_CALLBACK_SECRET is not configured — rejecting callback");
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Server misconfiguration" }, { status: 500 });
    }

    const provided = req.headers.get("x-mpesa-secret") ?? "";
    if (provided !== callbackSecret) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Unauthorized" }, { status: 401 });
    }
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

  if (isSandbox) {
    // Daraja sandbox sends directly to CallBackURL and cannot attach our custom
    // header. Only accept a callback for an STK request created by this server.
    // This exception is deliberately sandbox-only: checkout IDs are returned
    // to the browser and are not sufficient authentication for production.
    const { data: initiated, error: lookupError } = await admin
      .from("mpesa_stk_requests")
      .select("checkout_request_id")
      .eq("checkout_request_id", checkoutRequestId)
      .maybeSingle();

    if (lookupError) {
      console.error("[mpesa/callback] Failed to validate sandbox checkout:", lookupError);
      return NextResponse.json(
        { ResultCode: 1, ResultDesc: "Internal error — please retry" },
        { status: 500 }
      );
    }

    if (!initiated) {
      return NextResponse.json(
        { ResultCode: 1, ResultDesc: "Unknown checkout request" },
        { status: 401 }
      );
    }
  }

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
