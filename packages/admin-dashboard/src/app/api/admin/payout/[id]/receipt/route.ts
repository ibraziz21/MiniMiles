import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.read");
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

  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
