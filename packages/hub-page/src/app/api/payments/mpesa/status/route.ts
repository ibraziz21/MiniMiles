import { NextRequest, NextResponse } from "next/server";
import { stkQuery, isMpesaConfigured } from "@/lib/mpesa";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  if (!isMpesaConfigured()) {
    return NextResponse.json({ error: "M-Pesa not configured" }, { status: 503 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();

  // Check callback table first — only return "success" when the callback IS
  // recorded in the DB.  This ensures the orders route always finds the callback
  // row when the CartDrawer calls createOrders after seeing "success" here.
  const { data: stkResult } = await admin
    .from("mpesa_stk_results")
    .select("result_code, receipt_number, amount_kes, phone")
    .eq("checkout_request_id", id)
    .maybeSingle();

  if (stkResult) {
    if (stkResult.result_code === "0" && stkResult.receipt_number) {
      return NextResponse.json({
        status:        "success",
        receiptNumber: stkResult.receipt_number as string,
        amount:        stkResult.amount_kes as number,
        phone:         stkResult.phone as string,
      });
    }
    return NextResponse.json({ status: "failed", reason: "Payment was not successful" });
  }

  // Callback not yet recorded — query Daraja for early failure detection.
  // If Daraja says "failed" we can tell the user immediately.
  // If Daraja says "success" or "pending", wait for the callback to arrive in DB
  // before declaring success (prevents a race where Daraja responds before the
  // callback POST completes the DB write).
  try {
    const daraja = await stkQuery(id);
    if (daraja.status === "failed") {
      return NextResponse.json(daraja);
    }
    return NextResponse.json({ status: "pending" });
  } catch (e) {
    console.error("[mpesa/status]", e);
    return NextResponse.json({ status: "pending" });
  }
}
