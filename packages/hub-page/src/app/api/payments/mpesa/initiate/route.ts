import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stkPush, normalizePhone, USD_TO_KES, isMpesaConfigured } from "@/lib/mpesa";

export async function POST(req: NextRequest) {
  if (!isMpesaConfigured()) {
    return NextResponse.json({ error: "M-Pesa not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { phone, amount_usd, merchant_name } = body;

  if (!phone || !amount_usd) {
    return NextResponse.json({ error: "Missing phone or amount" }, { status: 400 });
  }

  const phoneKe = normalizePhone(String(phone));
  if (phoneKe.length !== 12) {
    return NextResponse.json({ error: "Invalid Kenyan phone number" }, { status: 400 });
  }

  const amountKes = Math.ceil(Number(amount_usd) * USD_TO_KES);

  try {
    const result = await stkPush(
      phoneKe,
      amountKes,
      merchant_name ?? "AkibaHub",
      "Payment for order"
    );

    // Persist the STK request BEFORE returning the checkout ID to the client.
    // If this write fails the orders route cannot verify this payment, so we
    // must return an error instead of giving the client an unverifiable reference.
    const admin = createAdminClient();
    const { error: insertErr } = await admin.from("mpesa_stk_requests").insert({
      hub_user_id:          user.id,
      checkout_request_id:  result.checkoutRequestId,
      phone:                phoneKe,
      amount_kes:           amountKes,
    });

    if (insertErr) {
      console.error("[mpesa/initiate] Failed to persist STK request:", insertErr);
      return NextResponse.json(
        { error: "Failed to record M-Pesa initiation — please retry" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      checkoutRequestId: result.checkoutRequestId,
      amountKes,
      usdToKes: USD_TO_KES,
    });
  } catch (e) {
    console.error("[mpesa/initiate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "STK push failed" },
      { status: 500 }
    );
  }
}
