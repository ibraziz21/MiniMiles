import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnedAddresses, ownsOrder } from "@/lib/akiba/order-ownership";

// POST /api/shop/orders/[id]/dispute — "I didn't receive this"
// delivered -> disputed (customer). Freezes auto-complete by construction:
// the auto-complete sweep only ever looks at status='delivered'.
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { reason?: string; detail?: string };
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const ownedAddresses = await getOwnedAddresses(admin, user.id);

  const { data: order } = await admin
    .from("merchant_transactions")
    .select("id, status, user_address")
    .eq("id", params.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (!ownsOrder(order.user_address, user, ownedAddresses)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.status !== "delivered") {
    return NextResponse.json(
      { error: "Order must be in delivered state to dispute" },
      { status: 409 }
    );
  }

  const { data: rows, error } = await admin.rpc("advance_order_status", {
    p_order_id: params.id,
    p_to_status: "disputed",
    p_actor: "customer",
    p_meta: { reason: body.reason.trim(), detail: body.detail?.trim() || undefined },
  });

  const result = (rows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (error || !result?.ok) {
    return NextResponse.json(
      { error: result?.error_code ?? error?.message ?? "Could not open dispute" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
