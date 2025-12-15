// src/lib/prosperityBadges.ts
import type { StaticImageData } from "next/image";
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";

/* ──────────────────────────────────────────────────────────────── */
/*  Debug helper                                                   */
/* ──────────────────────────────────────────────────────────────── */

const DEBUG_BADGES = true;

function dbg(...args: any[]) {
  if (!DEBUG_BADGES) return;
  console.log("[Badges]", ...args);
}

/* ──────────────────────────────────────────────────────────────── */
/*  Badge metadata (UI)                                           */
/* ──────────────────────────────────────────────────────────────── */

export type BadgeKey =
  | "cel2-transactions"
  | "s1-transactions"
  | "lam-lifetime-akiba"
  | "amg-akiba-games";

/**
 * For the dashboard:
 *   BadgeProgress[key] = number of completed tiers (0–5)
 * NOT raw tx count / Miles.
 */
export type BadgeProgress = Record<BadgeKey, number>;

export type BadgeTierDef = {
  id: string;
  label: string;
  usersCompletedLabel: string;
  requirement: string;
  threshold: number; // purely for copy in detail modal
};

export type BadgeDef = {
  key: BadgeKey;
  title: string;
  shortDescription: string;
  detailDescription: string;
  unitLabel: string;
  activeIcon: StaticImageData;
  inactiveIcon: StaticImageData;
  tiers: BadgeTierDef[];
};

// Icons
import s1uActive from "@/public/svg/badges/s1u-active.svg";
import s1uInactive from "@/public/svg/badges/s1u-inactive.svg";
import cel2Active from "@/public/svg/badges/cel2-active.svg";
import cel2Inactive from "@/public/svg/badges/cel2-inactive.svg";
import lamActive from "@/public/svg/badges/lam-active.svg";
import lamInactive from "@/public/svg/badges/lam-inactive.svg";
import amgActive from "@/public/svg/badges/amg-active.svg";
import amgInactive from "@/public/svg/badges/amg-inactive.svg";

export const BADGES: BadgeDef[] = [
  {
    key: "cel2-transactions",
    title: "CEL2 Transactions",
    shortDescription: "Transactions on CEL2",
    detailDescription:
      "The number of transactions (transfers, swaps, deposits, etc.) you’ve made on CEL2.",
    unitLabel: "Transactions",
    activeIcon: cel2Active,
    inactiveIcon: cel2Inactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most users",
        requirement: "10 transactions on CEL2",
        threshold: 10,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Advanced users",
        requirement: "50 transactions on CEL2",
        threshold: 50,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "Power users",
        requirement: "100 transactions on CEL2",
        threshold: 100,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "Top 1%",
        requirement: "250 transactions on CEL2",
        threshold: 250,
      },
      {
        id: "t5",
        label: "Tier 5",
        usersCompletedLabel: "Top 0.1%",
        requirement: "500 transactions on CEL2",
        threshold: 500,
      },
    ],
  },
  {
    key: "s1-transactions",
    title: "S1 Transactions (S1U)",
    shortDescription: "Transactions on Celo Season 1",
    detailDescription:
      "The number of transactions (transfers, swaps, deposits, etc.) you’ve made on Celo during Season 1.",
    unitLabel: "Transactions",
    activeIcon: s1uActive,
    inactiveIcon: s1uInactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most users",
        requirement: "10 transactions on Celo in Season 1",
        threshold: 10,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Advanced users",
        requirement: "50 transactions on Celo in Season 1",
        threshold: 50,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "Power users",
        requirement: "100 transactions on Celo in Season 1",
        threshold: 100,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "Top 1%",
        requirement: "250 transactions on Celo in Season 1",
        threshold: 250,
      },
      {
        id: "t5",
        label: "Tier 5",
        usersCompletedLabel: "Top 0.1%",
        requirement: "500 transactions on Celo in Season 1",
        threshold: 500,
      },
    ],
  },
  {
    key: "lam-lifetime-akiba",
    title: "LAM · Lifetime AkibaMiles Earned",
    shortDescription: "Total AkibaMiles earned",
    detailDescription:
      "All AkibaMiles you have earned across the Akiba dApp (quests, raffles, games, and more).",
    unitLabel: "AkibaMiles",
    activeIcon: lamActive,
    inactiveIcon: lamInactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most users",
        requirement: "Earn 250 AkibaMiles",
        threshold: 250,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Engaged",
        requirement: "Earn 1,000 AkibaMiles",
        threshold: 1_000,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "Dedicated",
        requirement: "Earn 5,000 AkibaMiles",
        threshold: 5_000,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "Top 1%",
        requirement: "Earn 20,000 AkibaMiles",
        threshold: 20_000,
      },
      {
        id: "t5",
        label: "Tier 5",
        usersCompletedLabel: "Top 0.1%",
        requirement: "Earn 100,000 AkibaMiles",
        threshold: 100_000,
      },
    ],
  },
  {
    key: "amg-akiba-games",
    title: "AMG · AkibaMiles from Games",
    shortDescription: "Miles from games",
    detailDescription:
      "How many AkibaMiles you’ve earned specifically from playing games inside Akiba.",
    unitLabel: "AkibaMiles from games",
    activeIcon: amgActive,
    inactiveIcon: amgInactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most players",
        requirement: "Earn 100 AkibaMiles from games",
        threshold: 100,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Regular players",
        requirement: "Earn 1000 AkibaMiles from games",
        threshold: 1000,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "High rollers",
        requirement: "Earn 10,000 AkibaMiles from games",
        threshold: 10_000,
      },
    ],
  },
];

export const BADGE_BY_KEY: Record<BadgeKey, BadgeDef> = BADGES.reduce(
  (acc, b) => {
    acc[b.key] = b;
    return acc;
  },
  {} as Record<BadgeKey, BadgeDef>
);

/* ──────────────────────────────────────────────────────────────── */
/*  Backend mapping + types                                        */
/* ──────────────────────────────────────────────────────────────── */

/**
 * All three IDs wired:
 *   18 → cel2-transactions
 *   22 → s1-transactions
 *   27 → lam-lifetime-akiba
 */
const BADGE_ID_BY_KEY: Record<BadgeKey, number | null> = {
  "cel2-transactions": 18,
  "s1-transactions": 22,
  "lam-lifetime-akiba": 27,
  "amg-akiba-games": 30, // still local-only
};

export const EMPTY_BADGE_PROGRESS: BadgeProgress = {
  "cel2-transactions": 0,
  "s1-transactions": 0,
  "lam-lifetime-akiba": 0,
  "amg-akiba-games": 0,
};

type TierMetadata = {
  badgeId: number;
  level: number;
  minValue: number;
  points: number;
};

type BackendBadgeTier = {
  points: string;
  tier: string;
  uri: string;
  metadata: TierMetadata;
};

type BackendBadge = {
  badgeId: string;
  badgeTiers: BackendBadgeTier[];
  uri: string;
  metadata: {
    name: string;
    description: string;
    platform: string;
    chains: string[];
    condition: string;
    image: string;
    "stack-image": string;
    season: number | null;
  };
  points: number;
  tier: number;             // claimed tier (what we use for steps)
  claimableTier: number | null; // higher tier user can claim
  claimable: boolean;
};

type BackendBadgesResponse = {
  currentBadges: BackendBadge[];
};

/* For filtering/logging just the ones we care about */
const RELEVANT_BADGE_IDS = new Set<number>([18, 22, 27]);

/* ──────────────────────────────────────────────────────────────── */
/*  Call our OWN Next.js API: /api/user/[safe]                     */
/* ──────────────────────────────────────────────────────────────── */

async function fetchBadgesFromApi(
  safe: `0x${string}`
): Promise<BackendBadgesResponse | null> {
  const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
  const url = `${base}/api/user/${safe}`; // app/api/user/[safe]/route.ts

 

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });



    if (!res.ok) {
      dbg("[Badges] API not ok, returning null");
      return null;
    }

    const data = (await res.json()) as BackendBadgesResponse;
    const currentBadges = data.currentBadges ?? [];

    

    const relevant = currentBadges.filter((b) =>
      RELEVANT_BADGE_IDS.has(Number(b.badgeId))
    );

    dbg(
      "[Badges] Relevant badges (18,22,27):",
      relevant.map((b) => ({
        badgeId: b.badgeId,
        name: b.metadata?.name,
        tier: b.tier,
        claimableTier: b.claimableTier,
        points: b.points,
        claimable: b.claimable,
      }))
    );

    const claimableOrTier = relevant.filter((b) => {
      const t = typeof b.tier === "number" ? b.tier : 0;
      const ct =
        typeof b.claimableTier === "number" ? b.claimableTier : 0;
      return t > 0 || ct > 0;
    });

    return data;
  } catch (err) {
    console.error("[Badges] ERROR calling /api/user/[safe]:", err);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/*  Map backend → #completed steps (0–5)                           */
/* ──────────────────────────────────────────────────────────────── */

/**
 * For UI steps:
 *   - Use badge.tier only.
 *   - tier is 0 if nothing claimed (even if claimableTier > 0).
 *   - Clamp to [0, def.tiers.length].
 */
function deriveStepsFromBadge(
  backend: BackendBadge,
  def: BadgeDef
): number {
  const rawTier =
    typeof backend.tier === "number" ? backend.tier : 0;

  dbg("deriveStepsFromBadge", {
    badgeId: backend.badgeId,
    name: backend.metadata?.name,
    tier: backend.tier,
    claimableTier: backend.claimableTier,
  });

  if (!rawTier || rawTier <= 0) {
    dbg("→ no claimed tier, steps = 0");
    return 0;
  }

  const steps = Math.max(0, Math.min(rawTier, def.tiers.length));
  dbg("→ steps from tier:", steps, "/", def.tiers.length);
  return steps;
}

/* ──────────────────────────────────────────────────────────────── */
/*  PUBLIC: fetchBadgeProgressForUser(owner EOA)                   */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchBadgeProgressForUser(
  owner: `0x${string}`
): Promise<BadgeProgress> {
  dbg("fetchBadgeProgressForUser called with owner:", owner);

  let safe: `0x${string}` | null = null;

  try {
    const result: any = await fetchSuperAccountForOwner(owner);
    dbg("fetchSuperAccountForOwner result:", result);

    if (result?.hasPassport && result?.account?.smartAccount) {
      safe = result.account.smartAccount as `0x${string}`;
      dbg("Resolved SAFE from helper:", safe);
    } else {
      dbg(
        "No SAFE from helper (no passport or missing smartAccount). Returning all zeros."
      );
      return { ...EMPTY_BADGE_PROGRESS };
    }
  } catch (err) {
    console.error("[Badges] Error in fetchSuperAccountForOwner:", err);
    return { ...EMPTY_BADGE_PROGRESS };
  }

  const data = await fetchBadgesFromApi(safe);
  if (!data) {
    dbg("No data from API, returning EMPTY_BADGE_PROGRESS.");
    return { ...EMPTY_BADGE_PROGRESS };
  }

  const backendBadges = data.currentBadges ?? [];

  const progress: BadgeProgress = { ...EMPTY_BADGE_PROGRESS };

  (Object.keys(progress) as BadgeKey[]).forEach((key) => {
    const badgeId = BADGE_ID_BY_KEY[key];
    const def = BADGE_BY_KEY[key];

    dbg(`Mapping key=${key} → badgeId=`, badgeId, "title=", def.title);

    if (badgeId == null) {
      dbg(`No badgeId mapped for key=${key}; leaving steps=0.`);
      progress[key] = 0;
      return;
    }

    const backendBadge = backendBadges.find(
      (b) => Number(b.badgeId) === badgeId
    );

    if (!backendBadge) {
      dbg(
        `No backend badge found for badgeId=${badgeId} (key=${key}); steps=0.`
      );
      progress[key] = 0;
      return;
    }

    const steps = deriveStepsFromBadge(backendBadge, def);
    dbg(`Final steps for key=${key} (badgeId=${badgeId}):`, steps);
    progress[key] = steps;
  });

  dbg("Final computed BadgeProgress (steps):", progress);
  return progress;
}
