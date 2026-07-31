// GET /api/quests/status — merchant-shopping-quests-spec.md §6.
// Authenticated, private/no-store. Returns the local launch catalog joined
// with Platform completion/reward state for the caller's email + every
// linked wallet. A Platform outage degrades individual quests to
// "verifying" rather than erasing known local progress or failing the
// whole request.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHubQuestStatuses } from "@/lib/akiba/questStatus";
import { getLedgerBalance } from "@/lib/akiba/activity";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = user.email ?? null;

  if (!isHubQuestsEnabledFor(email ?? user.id)) {
    return NextResponse.json(
      { quests: [], balance: 0, rolloutDisabled: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const wallets = await getLinkedWalletAddresses(user.id);

  const [quests, balance] = await Promise.all([
    getHubQuestStatuses({ hubUserId: user.id, email }),
    getLedgerBalance({ email, walletAddress: wallets[0] ?? null }),
  ]);

  return NextResponse.json(
    { quests, balance },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
