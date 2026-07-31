import { createClient } from "@/lib/supabase/server";
import { getHubQuestStatuses, type HubQuestStatus } from "@/lib/akiba/questStatus";
import { getLedgerBalance } from "@/lib/akiba/activity";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";
import { QuestsPageClient } from "./QuestsPageClient";

export const metadata = { title: "Earn Miles — Akiba Pass" };

export default async function QuestsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isSignedIn = !!user;

  let quests: HubQuestStatus[] = [];
  let balance = 0;
  const rolloutEnabled = user ? isHubQuestsEnabledFor(user.email ?? user.id) : false;
  if (user && rolloutEnabled) {
    const wallets = await getLinkedWalletAddresses(user.id);
    [quests, balance] = await Promise.all([
      getHubQuestStatuses({ hubUserId: user.id, email: user.email ?? null }),
      getLedgerBalance({ email: user.email ?? null, walletAddress: wallets[0] ?? null }),
    ]);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:py-8 sm:px-6 lg:px-8">
      <div className="mb-5 sm:mb-8">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">
          Earn Miles
        </h1>
        <p className="mt-1 text-sm text-akiba-muted sm:mt-2">
          Shop, explore offers, and use your Akiba Pass.
        </p>
      </div>

      <QuestsPageClient
        initialQuests={quests}
        initialBalance={balance}
        isSignedIn={isSignedIn}
        rolloutEnabled={rolloutEnabled}
      />
    </main>
  );
}
