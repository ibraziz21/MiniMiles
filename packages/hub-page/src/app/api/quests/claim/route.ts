// POST /api/quests/claim — merchant-shopping-quests-spec.md §6.
// Replaces the previous quest_id -> MiniPay wallet -> Platform claim
// contract. No wallet is required: ownership is resolved from the caller's
// email + linked wallets, cross-checked against Hub's own quest-status
// derivation before ever calling Platform, and Platform enforces the same
// ownership check server-side against `identities` (see
// hub-account-first-quest-claims-spec.md in the Akiba-Platform repo).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIdentities } from "@/lib/akiba/identities";
import { getHubQuestStatuses } from "@/lib/akiba/questStatus";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHubQuestsEnabledFor(user.email ?? user.id)) {
    return NextResponse.json({ error: "Not available yet" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rewardId = body?.rewardId;
  if (typeof rewardId !== "string" || !rewardId) {
    return NextResponse.json({ error: "rewardId is required" }, { status: 400 });
  }

  const email = user.email ?? null;
  const identities = await buildIdentities({ userId: user.id, email });

  // Hub's own authoritative ownership check — never trust a client-supplied
  // rewardId blindly. Only proceed if this reward surfaced as `claimable`
  // for one of the caller's own quests.
  const statuses = await getHubQuestStatuses({ hubUserId: user.id, email });
  const owned = statuses.find((q) => q.rewardId === rewardId && q.state === "claimable");
  if (!owned) {
    return NextResponse.json({ error: "Reward not found or not claimable" }, { status: 403 });
  }

  const api = process.env.AKIBA_API_URL;
  const key = process.env.AKIBA_API_KEY;
  if (!api || !key) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let platformRes: Response;
  try {
    platformRes = await fetch(`${api}/api/v1/rewards/${rewardId}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ identities }),
    });
  } catch {
    return NextResponse.json(
      { state: "reward_failed", reason: "platform_unavailable" },
      { status: 503 },
    );
  }

  const data = (await platformRes.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { status?: string };
    error?: { code?: string; message?: string };
  };

  if (!platformRes.ok || !data.success) {
    return NextResponse.json(
      {
        state: "reward_failed",
        reason: data.error?.code ?? `platform_${platformRes.status}`,
        error: data.error?.message ?? "Claim failed",
      },
      { status: platformRes.status },
    );
  }

  return NextResponse.json({
    state: data.data?.status === "claimed" ? "completed" : "claimable",
    miles: owned.miles,
    rewardId,
  });
}
