export type DiscoveryIntent = {
  id: string;
  slug: string;
  label: string;
  iconKey: string;
  query: string;
  categorySlug?: string;
  active: boolean;
  sortOrder: number;
  startsAt?: string;
  endsAt?: string;
};

export type MatchReason =
  | { kind: "intent"; label: string }
  | { kind: "distance"; distanceKm: number }
  | { kind: "voucher"; label: string; templateId: string }
  | { kind: "affordable"; templateId: string }
  | { kind: "affinity"; label: string }
  | { kind: "earn"; label: string }
  | { kind: "availability"; label: string }
  | { kind: "new"; label: string };

export type MerchantValueSummary = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  /**
   * Merchant-uploaded cover photo (partner_settings.banner_url,
   * merchant-dashboard/sql/009_partner_banner_image.sql) — used as the
   * card's header image in place of the logo-on-flat-background fallback
   * when set. Not yet returned by the list_public_merchants /
   * get_public_merchant directory RPCs (external, outside this repo), so
   * today only buildLimitedTimeSection (home/feed.ts) can populate it;
   * every other section passes null until those RPCs are updated to select
   * it too.
   */
  bannerUrl: string | null;
  primaryCategory: { slug: string; name: string } | null;
  matchedOffering: string | null;
  operatingModel: "physical" | "hybrid" | "online";
  nearestLocation: null | {
    id: string;
    locality: string | null;
    city: string;
    distanceKm: number | null;
    openStatus: "open" | "closed" | "unknown";
    closesAt: string | null;
  };
  topOffer: null | {
    templateId: string;
    label: string;
    milesCost: number;
    affordable: boolean | null;
    expiresAt: string | null;
  };
  earnSummary: null | {
    label: string;
    deterministic: boolean;
  };
  reasons: MatchReason[];
  /**
   * Total canonically-available voucher count (merchant-directory spec's
   * "truthful available-voucher count"). Independent of `topOffer` — home
   * rails don't set this (they don't need a raw count), the `/merchants`
   * directory does.
   */
  voucherCount?: number;
  /**
   * Branch count from PublicMerchantSummary — carried through only for the
   * directory-context card (discovery-blueprint.md §5), which shows it next
   * to the nearest-branch location line. Home rails don't set this.
   */
  branchCount?: number;
};

export type HomeFeedSection = {
  id: "for_you" | "nearby" | "popular" | "new" | "limited_time";
  title: string;
  personalized: boolean;
  merchants: MerchantValueSummary[];
};

export type HomeFeedResponse = {
  rankingVersion: string;
  generatedAt: string;
  intents: DiscoveryIntent[];
  sections: HomeFeedSection[];
  rewards: null | {
    milesBalance: number;
    /**
     * The single soonest-expiring active voucher, for the "continue this"
     * strip (discovery-blueprint.md §3, workstream 7) — null when there's
     * nothing urgent enough to interrupt with. Nested under `rewards`
     * (rather than a separate top-level field) because it shares the same
     * wallet-resolution dependency and failure fate as the Miles balance —
     * see getRewardsSnapshot in lib/home/feed.ts.
     */
    continueVoucher: import("@/lib/akiba/myVouchers").SoonestExpiringVoucher | null;
  };
  /**
   * Next Reward Progress V1 (next-reward-progress-v1-spec.md) — null when
   * signed out, or when the summary itself failed independently of every
   * other section (see getNextRewardSummary in lib/akiba/nextReward.ts).
   */
  nextReward: import("@/lib/akiba/nextReward").NextRewardSummary | null;
};
