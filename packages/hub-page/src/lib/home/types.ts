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
    activeVoucherCount: number;
    hasPass: boolean;
  };
};
