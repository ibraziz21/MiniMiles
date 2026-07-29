import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userOwnsVoucher } from "@/lib/vouchers/issuance";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);
  const addresses = (walletRows ?? []).map(
    (row: { address: string }) => row.address.toLowerCase(),
  );

  if (!(await userOwnsVoucher(id, user.id, addresses))) {
    return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
  }

  const [{ data: voucher }, { data: intent }] = await Promise.all([
    admin
      .from("issued_vouchers")
      .select("id, status, burn_tx_hash")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("miles_spend_intents")
      .select("state, failure_code, failure_reason, submitted_tx_hash")
      .eq("voucher_id", id)
      .maybeSingle(),
  ]);

  if (!voucher) {
    return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      voucher_status: voucher.status,
      intent_state: intent?.state ?? null,
      failure_code: intent?.failure_code ?? null,
      failure_reason: intent?.failure_reason ?? null,
      tx_hash: intent?.submitted_tx_hash ?? voucher.burn_tx_hash ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
