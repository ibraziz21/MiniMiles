// POST /api/quests/proof — merchant-shopping-quests-spec.md §6/§5 "Deal view".
// Launch use: deal_viewed only. Validates the supplied offer against live
// Hub inventory (reusing list_available_voucher_template_ids_hub — the same
// availability RPC /vouchers and merchants/queries.ts already use, never
// reimplemented here) before enqueueing a durable proof event.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildIdentities } from "@/lib/akiba/identities";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHubQuestsEnabledFor(user.email ?? user.id)) {
    return NextResponse.json({ error: "Not available yet" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const offerId = body?.offerId;
  if (typeof offerId !== "string" || !offerId) {
    return NextResponse.json({ error: "offerId is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: available, error: availErr } = await admin.rpc(
    "list_available_voucher_template_ids_hub",
    { p_hub_user_id: user.id },
  );
  if (availErr) {
    return NextResponse.json({ error: "Could not verify offer" }, { status: 502 });
  }
  const isAvailable = (available ?? []).some(
    (row: { template_id: string }) => row.template_id === offerId,
  );
  if (!isAvailable) {
    return NextResponse.json({ error: "Offer is not currently available" }, { status: 404 });
  }

  const identities = await buildIdentities({ userId: user.id, email: user.email ?? null });

  const { error: rpcErr } = await admin.rpc("record_hub_deal_view", {
    p_hub_user_id: user.id,
    p_offer_id: offerId,
    p_identities: identities,
    p_metadata: { hubUserId: user.id, offerId },
  });
  if (rpcErr) {
    console.error("[api/quests/proof] record_hub_deal_view failed:", rpcErr.message);
    return NextResponse.json({ error: "Could not record proof" }, { status: 500 });
  }

  return NextResponse.json({ queued: true }, { status: 202 });
}
