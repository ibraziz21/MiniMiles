import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

interface ReceiptRow {
  instruction_id: string;
  batch_id: string;
  provider_name: string;
  provider_reference: string | null;
  payment_method: string | null;
  payment_date: string | null;
  confirming_actor: string | null;
  amount: number;
  currency: string;
  confirmed_at: string | null;
  destination_display_name: string | null;
  destination_redacted: string | null;
  destination_type: string;
  partner_id: string;
  batch_total: number;
  batch_item_count: number;
  receipt_number: string | null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("v_payout_receipt")
    .select(
      "instruction_id, batch_id, provider_name, provider_reference, payment_method, " +
      "payment_date, confirming_actor, amount, currency, confirmed_at, " +
      "destination_display_name, destination_redacted, destination_type, " +
      "partner_id, batch_total, batch_item_count, receipt_number",
    )
    .eq("instruction_id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Receipt not found. Instruction may not be confirmed yet." },
      { status: 404 },
    );
  }

  const row = data as unknown as ReceiptRow;

  // Enforce: merchant can only access receipts for their own partner.
  if (row.partner_id !== session.partnerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const receiptNum = row.receipt_number ?? params.id;

  return NextResponse.json(row, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="receipt-${receiptNum}.json"`,
    },
  });
}
