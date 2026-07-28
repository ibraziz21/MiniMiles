// GET /api/quests/platform
//
// BFF for the Earn tab's "Discovery" quest group (discovery-quests-spec.md
// §5.1-5.2). Identity = the session wallet only (react-app users are
// wallet-first, per spec §2 rule 4). No Platform keys reach the client —
// this route holds the only Bearer credential.
//
// Composes three real Platform endpoints (there is no single "quest list +
// status" endpoint):
//   1. GET /api/v1/quests?status=active            — quests under the key's partner
//   2. GET /api/v1/quests/:id/completions?...       — has this wallet completed it?
//   3. GET /api/v1/rewards/:rewardId                — is the earned reward still claimable?
// 60s-per-wallet cache (lib/akiba/platformQuestCache.ts) softens the fan-out
// this requires on repeat polling.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { fetchPlatform } from "@/lib/akiba/platformClient";
import { getCachedQuests, setCachedQuests } from "@/lib/akiba/platformQuestCache";
import type { PlatformQuestDto, PlatformQuestStatus } from "@/lib/akiba/platformQuestCache";

export const dynamic = "force-dynamic";

type UpstreamQuest = {
  questId: string;
  name: string;
  description: string | null;
  rewardAmount: number;
  status: string;
  frequency: string;
};

type UpstreamCompletion = { rewardId: string | null };
type UpstreamReward = { status: string };

async function resolveQuestStatus(questId: string, wallet: string): Promise<{ status: PlatformQuestStatus; rewardId: string | null }> {
  const completions = await fetchPlatform<UpstreamCompletion[]>(
    `/api/v1/quests/${questId}/completions?identityType=wallet&identityValue=${encodeURIComponent(wallet)}&limit=1`
  );

  const completion = completions.ok ? completions.data[0] : undefined;
  if (completion?.rewardId) {
    const reward = await fetchPlatform<UpstreamReward>(`/api/v1/rewards/${completion.rewardId}`);
    const status: PlatformQuestStatus = reward.ok && reward.data.status === "claimed" ? "claimed" : "claimable";
    return { status, rewardId: completion.rewardId };
  }

  const verifications = await fetchPlatform<unknown[]>(
    `/api/v1/verifications?questId=${questId}&walletAddress=${encodeURIComponent(wallet)}&status=verified&limit=1`
  );
  const verified = verifications.ok && verifications.data.length > 0;
  return { status: verified ? "pending" : "locked", rewardId: null };
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wallet = session.walletAddress.toLowerCase();

  const cached = getCachedQuests(wallet);
  if (cached) {
    return NextResponse.json({ quests: cached }, { headers: { "Cache-Control": "no-store" } });
  }

  // No status filter here: /api/v1/quests's status param is a single-value
  // exact match, and a live-visible quest can be either 'active' or 'live'
  // (same two-status convention /api/v1/hub/quests uses) — filtered below.
  const questsResult = await fetchPlatform<UpstreamQuest[]>("/api/v1/quests?limit=50");
  if (!questsResult.ok) {
    return NextResponse.json(
      { error: questsResult.error, degraded: true, retryable: true },
      { status: questsResult.status >= 500 || questsResult.status === 504 ? 502 : questsResult.status }
    );
  }

  const quests: PlatformQuestDto[] = await Promise.all(
    questsResult.data
      .filter((q) => q.status === "active" || q.status === "live")
      .map(async (q) => {
        const { status, rewardId } = await resolveQuestStatus(q.questId, wallet);
        return {
          questId: q.questId,
          name: q.name,
          description: q.description,
          rewardAmount: q.rewardAmount,
          frequency: q.frequency,
          status,
          rewardId,
        };
      })
  );

  setCachedQuests(wallet, quests);

  return NextResponse.json({ quests }, { headers: { "Cache-Control": "no-store" } });
}
