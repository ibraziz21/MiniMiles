import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = supabase
    .from("voucher_settlement_entries")
    .select("id,program_id,gross_amount_cusd,discount_amount_cusd,reimbursement_rate,payable_amount,currency,created_at")
    .eq("merchant_id", session.partnerId)
    .order("created_at", { ascending: false });
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Export failed" }, { status: 500 });

  const header = [
    "entry_id","program_id","gross_amount_cusd","discount_amount_cusd",
    "reimbursement_rate","payable_amount","currency","created_at",
  ];
  const rows = (data ?? []).map((row) => [
    row.id,row.program_id,row.gross_amount_cusd,row.discount_amount_cusd,
    row.reimbursement_rate,row.payable_amount,row.currency,row.created_at,
  ].map(csvCell).join(","));

  return new NextResponse([header.join(","), ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="voucher-settlements.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
