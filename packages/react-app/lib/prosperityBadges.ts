// src/lib/prosperityBadges.ts
import type { StaticImageData } from "next/image";

/* ──────────────────────────────────────────────────────────────── */
/*  Debug helper                                                   */
/* ──────────────────────────────────────────────────────────────── */

const DEBUG_BADGES = true;

function dbg(...args: any[]) {
  if (!DEBUG_BADGES) return;
  // eslint-disable-next-line no-console
  console.log("[Badges]", ...args);
}

/* ──────────────────────────────────────────────────────────────── */
/*  Badge metadata (UI)                                            */
/* ──────────────────────────────────────────────────────────────── */

export type BadgeKey =
  | "cel2-transactions"
  | "s1-transactions"
  | "lam-lifetime-akiba"
  | "amg-akiba-games";

/**
 * IMPORTANT:
 * BadgeProgress[key] is the RAW metric value:
 *  - tx badges: transaction count
 *  - LAM: lifetime AkibaMiles earned
 *  - AMG: AkibaMiles earned from games
 * NOT tiers/steps.
 */
export type BadgeProgress = Record<BadgeKey, number>;

export type BadgeTierDef = {
  id: string;
  label: string;
  usersCompletedLabel: string;
  requirement: string;
  threshold: number; // used for tier completion checks
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

export const EMPTY_BADGE_PROGRESS: BadgeProgress = {
  "cel2-transactions": 0,
  "s1-transactions": 0,
  "lam-lifetime-akiba": 0,
  "amg-akiba-games": 0,
};

/* ──────────────────────────────────────────────────────────────── */
/*  Shared helpers (RAW value -> tiers)                             */
/* ──────────────────────────────────────────────────────────────── */

export function tiersCompletedFromValue(value: number, def: BadgeDef): number {
  const v = Number.isFinite(value) ? value : 0;
  if (v <= 0) return 0;

  let steps = 0;
  for (const t of def.tiers) {
    if (v >= t.threshold) steps++;
  }
  return Math.min(steps, def.tiers.length);
}

export function isBadgeCompletedFromValue(value: number, def: BadgeDef): boolean {
  if (!def.tiers.length) return false;
  return value >= def.tiers[def.tiers.length - 1].threshold;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Backend badge IDs (Prosperity backend)                           */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Prosperity badge IDs as provided by your backend:
 *   18 → cel2-transactions
 *   22 → s1-transactions
 *   27 → lam-lifetime-akiba
 *   30 → amg-akiba-games (not currently supplied by prosperity backend in your setup)
 */
export const BADGE_ID_BY_KEY: Record<BadgeKey, number | null> = {
  "cel2-transactions": 18,
  "s1-transactions": 22,
  "lam-lifetime-akiba": 27,
  "amg-akiba-games": 30,
};

/* ──────────────────────────────────────────────────────────────── */
/*  Optional: small debug utility                                  */
/* ──────────────────────────────────────────────────────────────── */

export function debugBadgeValue(key: BadgeKey, value: number) {
  if (!DEBUG_BADGES) return;
  const def = BADGE_BY_KEY[key];
  dbg("debugBadgeValue", {
    key,
    title: def.title,
    value,
    completedSteps: tiersCompletedFromValue(value, def),
    thresholds: def.tiers.map((t) => t.threshold),
  });
}
