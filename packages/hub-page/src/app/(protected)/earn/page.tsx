import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShopAndEarnCard, EarnCard } from "./EarnCards";
import { getHubQuestStatuses } from "@/lib/akiba/questStatus";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";
import { isGamesEnabledFor } from "@/lib/games/gamesRollout";
import { gamesBackend } from "@/lib/games/backendClient";
import { GAME_TYPES } from "@/lib/games/gameRewardRules";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { getReferralDashboard } from "@/lib/akiba/referralDashboard";

// Earn hub — akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §5.
// Games, quests and referrals no longer occupy primary-nav slots; this page
// is their coherent home. Shop & Earn is always shown, first, with the
// strongest visual weight (§5.2). Secondary-card summaries are best-effort:
// a summary failure degrades to static copy, it never blocks the page.
export const metadata = { title: "Earn Miles — Akiba Pass" };

async function loadActiveQuestCount(hubUserId: string, email: string | null): Promise<number | null> {
  try {
    const quests = await getHubQuestStatuses({ hubUserId, email });
    return quests.filter((q) => q.state === "eligible" || q.state === "needs_action" || q.state === "wallet_required").length;
  } catch (err) {
    console.error("[earn] active quest count failed:", err);
    return null;
  }
}

async function loadRemainingGamePlays(hubUserId: string, email: string | null): Promise<number | null> {
  try {
    const canonicalId = await resolveHubQuestCanonical({ hubUserId, email });
    const identity = { canonicalId, hubUserId };
    const results = await Promise.allSettled(GAME_TYPES.map((gameType) => gamesBackend.status(identity, gameType)));
    let anyFulfilled = false;
    let remaining = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        anyFulfilled = true;
        remaining += Math.max(result.value.playsRemaining, 0);
      }
    }
    return anyFulfilled ? remaining : null;
  } catch (err) {
    console.error("[earn] remaining game plays failed:", err);
    return null;
  }
}

async function loadPendingReferralMiles(hubUserId: string): Promise<number | null> {
  try {
    const dashboard = await getReferralDashboard(hubUserId);
    return dashboard.summary.milesPending;
  } catch (err) {
    console.error("[earn] pending referral miles failed:", err);
    return null;
  }
}

export default async function EarnPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/earn");

  const identifier = user.email ?? user.id;
  const questsEnabled = isHubQuestsEnabledFor(identifier);
  const gamesEnabled = isGamesEnabledFor(identifier);

  const [activeQuestCount, remainingGamePlays, pendingReferralMiles] = await Promise.all([
    questsEnabled ? loadActiveQuestCount(user.id, user.email ?? null) : Promise.resolve(null),
    gamesEnabled ? loadRemainingGamePlays(user.id, user.email ?? null) : Promise.resolve(null),
    loadPendingReferralMiles(user.id),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-24 sm:px-6">
      <div className="mb-6">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">Earn Miles</h1>
        <p className="mt-1 text-sm text-akiba-muted sm:mt-2">
          Earn more value when you shop, then use activities to get to your next reward faster.
        </p>
      </div>

      <div className="space-y-4">
        {/* Shop & Earn — always shown, strongest visual weight (§5.2) */}
        <ShopAndEarnCard />

        {questsEnabled && (
          <EarnCard
            item="quests"
            href="/quests"
            title="Quests"
            description="Complete simple actions to earn bonus Miles."
            summary={activeQuestCount !== null ? `${activeQuestCount} quest${activeQuestCount === 1 ? "" : "s"} to complete` : null}
          />
        )}

        {gamesEnabled && (
          <EarnCard
            item="games"
            href="/games"
            title="Games"
            description="Play free skill games and earn AkibaMiles — no wallet needed."
            summary={remainingGamePlays !== null ? `${remainingGamePlays} play${remainingGamePlays === 1 ? "" : "s"} left today` : null}
          />
        )}

        <EarnCard
          item="referrals"
          href="/referrals"
          title="Refer & Earn"
          description="Invite friends and earn Miles when they join and shop."
          summary={pendingReferralMiles !== null && pendingReferralMiles > 0 ? `${pendingReferralMiles.toLocaleString()} Miles pending` : null}
        />
      </div>
    </main>
  );
}
