import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseRewardJob } from "@/lib/akiba/reward-release";
import { getOwnedAddresses, ownsOrder } from "@/lib/akiba/order-ownership";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Ownership must consider every linked wallet, not just the first (#9
  // fix, same class of bug already fixed for GET /api/shop/orders).
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
      { error: "Order must be in delivered state to confirm receipt" },
      { status: 409 }
    );
  }

  // The only sanctioned way to change status — validates the transition
  // against order_status_transitions and writes the order_events audit row.
  const { data: rows, error } = await admin.rpc("advance_order_status", {
    p_order_id: params.id,
    p_to_status: "received",
    p_actor: "customer",
    p_meta: { source: "confirm_route" },
  });

  const result = (rows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (error || !result?.ok) {
    return NextResponse.json(
      { error: result?.error_code ?? error?.message ?? "Could not confirm receipt" },
      { status: 500 }
    );
  }

  // received -> completed, then release the reward accrued at purchase
  // (order-lifecycle-completion-spec.md §6). Order success already happened
  // above; a completion/reward hiccup here doesn't undo the receipt confirmation.
  const { data: completeRows, error: completeErr } = await admin.rpc("advance_order_status", {
    p_order_id: params.id,
    p_to_status: "completed",
    p_actor: "system",
    p_meta: { source: "confirm_route" },
  });
  const completeResult = (completeRows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (completeErr || !completeResult?.ok) {
    console.error("[orders/confirm] completed transition failed:", completeErr, completeResult);
    return NextResponse.json({ ok: true, reward: { issued: false, miles: 0, pending: true } });
  }

  const rewardResult = await releaseRewardJob(params.id);
  const reward = rewardResult
    ? rewardResult.ok
      ? { issued: rewardResult.rewardIssued, miles: rewardResult.milesAwarded, ...(rewardResult.reason ? { reason: rewardResult.reason } : {}) }
      : { issued: false, miles: 0, pending: true }
    : { issued: false, miles: 0, pending: false };

  return NextResponse.json({ ok: true, reward });
}
