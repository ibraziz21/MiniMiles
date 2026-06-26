import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Get linked wallet to verify ownership
  const { data: wallet } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const { data: order } = await admin
    .from("merchant_transactions")
    .select("id, status, user_address")
    .eq("id", params.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (
    wallet?.address !== order.user_address &&
    user.email !== order.user_address &&
    user.id !== order.user_address
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.status !== "delivered") {
    return NextResponse.json(
      { error: "Order must be in delivered state to confirm receipt" },
      { status: 409 }
    );
  }

  const { error } = await admin
    .from("merchant_transactions")
    .update({
      status: "received",
      received_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
