import { createClient } from "@/lib/supabase/server";
import { VoucherTabs } from "./VoucherTabs";
import {
  getAllTemplates,
  getFundedOffers,
  getLoyaltyOffers,
  getClaimedAllocationIds,
} from "@/lib/vouchers/catalogue.server";

export const metadata = { title: "Vouchers & Rewards — Akiba Pass" };
export const revalidate = 60;

export default async function VouchersPage({
  searchParams,
}: {
  searchParams: { quest?: string };
}) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  const [templates, fundedOffers, loyaltyOffers, claimedAllocationIds] = await Promise.all([
    getAllTemplates(user?.id ?? null),
    getFundedOffers(),
    getLoyaltyOffers(user?.id ?? null, user?.email ?? null),
    getClaimedAllocationIds(user?.id ?? null, user?.email ?? null),
  ]);
  const questMode = searchParams.quest === "deal_viewed";

  return (
    <main className="mx-auto max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-8 lg:px-8">
      <VoucherTabs
        templates={templates}
        fundedOffers={fundedOffers}
        loyaltyOffers={loyaltyOffers}
        claimedAllocationIds={[...claimedAllocationIds]}
        isSignedIn={!!user}
        questMode={questMode}
      />
    </main>
  );
}
