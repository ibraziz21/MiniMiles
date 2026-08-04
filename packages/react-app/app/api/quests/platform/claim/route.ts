// POST /api/quests/platform/claim
// Body: { rewardId: string }
//
// Second half of the BFF claim flow (discovery-quests-spec.md §5.3),
// mirroring the existing partner-quests eligibility→claim UX
// (helpers/partnerQuests.ts) even though Platform's own claim for
// offchain_auto rewards is a single idempotent call — the two-step split is
// this app's UX convention, not a Platform requirement. (onchain_claim's
// two-step claim-intent/claim-confirm EIP-712 flow does not apply to these
// quests — Miles land through this app's own mint pipeline instead, via the
// reward_issued webhook bridge in lib/minipointQueue.ts.)
//
// Verifies the reward actually belongs to the session wallet before
// forwarding the claim — the BFF is the only place holding the Platform key,
// so it's also the only enforcement point against claiming another wallet's
// reward through this proxy.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { fetchPlatform } from "@/lib/akiba/platformClient";
import { invalidateCachedQuests } from "@/lib/akiba/platformQuestCache";
import { CANONICAL_API_PARTNER_QUEST_IDS } from "@/lib/merchantDiscoveryQuests";

type UpstreamReward = { walletAddress: string | null; status: string; questId?: string };

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { rewardId?: unknown } | null;
  const rewardId = typeof body?.rewardId === "string" ? body.rewardId : null;
  if (!rewardId) return NextResponse.json({ error: "rewardId is required" }, { status: 400 });

  const wallet = session.walletAddress.toLowerCase();

  const rewardResult = await fetchPlatform<UpstreamReward>(`/api/v1/rewards/${rewardId}`);
  if (!rewardResult.ok) {
    return NextResponse.json({ error: rewardResult.error }, { status: rewardResult.status === 404 ? 404 : 502 });
  }
  if ((rewardResult.data.walletAddress ?? "").toLowerCase() !== wallet) {
    return NextResponse.json({ error: "Reward does not belong to this wallet" }, { status: 403 });
  }
  if (rewardResult.data.questId && CANONICAL_API_PARTNER_QUEST_IDS.has(rewardResult.data.questId)) {
    return NextResponse.json(
      { error: "This quest is managed by the shared completion service" },
      { status: 409 },
    );
  }

  const claimResult = await fetchPlatform(`/api/v1/rewards/${rewardId}/claim`, { method: "POST", body: "{}" });
  if (!claimResult.ok) {
    return NextResponse.json({ error: claimResult.error }, { status: claimResult.status >= 500 ? 502 : claimResult.status });
  }

  invalidateCachedQuests(wallet);

  return NextResponse.json({ ok: true, reward: claimResult.data });
}
