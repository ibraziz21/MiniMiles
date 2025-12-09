// src/lib/prosperityBadges.ts
import type { StaticImageData } from "next/image";

// TODO: replace these imports with your actual files
import s1uActive from "@/public/svg/badges/s1u-active.svg";
import s1uInactive from "@/public/svg/badges/s1u-inactive.svg";
import b2Active from "@/public/svg/badges/cel2-active.svg";
import b2Inactive from "@/public/svg/badges/cel2-inactive.svg";
import b3Active from "@/public/svg/badges/lam-active.svg";
import b3Inactive from "@/public/svg/badges/lam-inactive.svg";
import b4Active from "@/public/svg/badges/amg-active.svg";
import b4Inactive from "@/public/svg/badges/amg-inactive.svg";

export type BadgeTierDef = {
  id: string;
  label: string;                 // "Tier 1"
  usersCompletedLabel: string;   // "10.8K (84%) Users Completed"
  requirement: string;           // "10 transactions on Celo in Season 1"
  threshold: number;             // numeric threshold to mark as done
};


export type BadgeProgress = Record<string, number>;

export type BadgeDef = {
  key: string;                   // "s1-transactions"
  title: string;                 // "Season 1 Transactions"
  shortDescription: string;      // used on small cards if needed
  detailDescription: string;     // paragraph in the modal
  unitLabel: string;             // "Transactions"
  activeIcon: StaticImageData;
  inactiveIcon: StaticImageData;
  tiers: BadgeTierDef[];
};

export const BADGES: BadgeDef[] = [
  {
    key: "s1-transactions",
    title: "Season 1 Transactions",
    shortDescription: "Number of transactions on Celo in Season 1",
    detailDescription:
      "The number of transactions (transfer, swaps, deposits etc.) on the Celo network in Season 1.",
    unitLabel: "Transactions",
    activeIcon: s1uActive,
    inactiveIcon: s1uInactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "10.8K (84%) Users Completed",
        requirement: "10 transactions on Celo in Season 1",
        threshold: 10,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "4.3K (57%) Users Completed",
        requirement: "50 transactions on Celo in Season 1",
        threshold: 50,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "1.2K (26%) Users Completed",
        requirement: "100 transactions on Celo in Season 1",
        threshold: 100,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "210 (1%) Users Completed",
        requirement: "250 transactions on Celo in Season 1",
        threshold: 250,
      },
      {
        id: "t-max",
        label: "Tier MAX",
        usersCompletedLabel: "15 (0.01%) Users Completed",
        requirement: "500 transactions on Celo in Season 1",
        threshold: 500,
      },
    ],
  },

  // 👉 The next 3 are placeholders – you can tweak copy/thresholds as needed
  {
    key: "s1-volume",
    title: "Season 1 Volume",
    shortDescription: "Total value moved on Celo in Season 1",
    detailDescription:
      "The cumulative value you’ve moved on Celo in Season 1 across transfers, swaps and deposits.",
    unitLabel: "cUSD Volume",
    activeIcon: b2Active,
    inactiveIcon: b2Inactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most users",
        requirement: "Move at least 50 cUSD",
        threshold: 50,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Advanced users",
        requirement: "Move at least 250 cUSD",
        threshold: 250,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "Power users",
        requirement: "Move at least 1,000 cUSD",
        threshold: 1000,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "Top 1%",
        requirement: "Move at least 5,000 cUSD",
        threshold: 5000,
      },
      {
        id: "t-max",
        label: "Tier MAX",
        usersCompletedLabel: "Top 0.1%",
        requirement: "Move at least 10,000 cUSD",
        threshold: 10000,
      },
    ],
  },
  {
    key: "minipay-activity",
    title: "MiniPay Activity",
    shortDescription: "Consistent activity inside MiniPay",
    detailDescription:
      "How many days you’ve actively used MiniPay during Season 1.",
    unitLabel: "Active Days",
    activeIcon: b3Active,
    inactiveIcon: b3Inactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most users",
        requirement: "Use MiniPay on 3 days",
        threshold: 3,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Regulars",
        requirement: "Use MiniPay on 7 days",
        threshold: 7,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "Fans",
        requirement: "Use MiniPay on 15 days",
        threshold: 15,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "Superfans",
        requirement: "Use MiniPay on 30 days",
        threshold: 30,
      },
      {
        id: "t-max",
        label: "Tier MAX",
        usersCompletedLabel: "Legends",
        requirement: "Use MiniPay on 60 days",
        threshold: 60,
      },
    ],
  },
  {
    key: "akiba-engagement",
    title: "Akiba Engagement",
    shortDescription: "Quests & games completed in AkibaMiles",
    detailDescription:
      "How many AkibaMiles quests, games and raffles you’ve completed in Season 1.",
    unitLabel: "Actions",
    activeIcon: b4Active,
    inactiveIcon: b4Inactive,
    tiers: [
      {
        id: "t1",
        label: "Tier 1",
        usersCompletedLabel: "Most users",
        requirement: "Complete 5 actions",
        threshold: 5,
      },
      {
        id: "t2",
        label: "Tier 2",
        usersCompletedLabel: "Engaged",
        requirement: "Complete 15 actions",
        threshold: 15,
      },
      {
        id: "t3",
        label: "Tier 3",
        usersCompletedLabel: "Dedicated",
        requirement: "Complete 30 actions",
        threshold: 30,
      },
      {
        id: "t4",
        label: "Tier 4",
        usersCompletedLabel: "Top 1%",
        requirement: "Complete 60 actions",
        threshold: 60,
      },
      {
        id: "t-max",
        label: "Tier MAX",
        usersCompletedLabel: "Top 0.1%",
        requirement: "Complete 100 actions",
        threshold: 100,
      },
    ],
  },
];

export const BADGE_BY_KEY: Record<string, BadgeDef> = BADGES.reduce(
  (acc, b) => {
    acc[b.key] = b;
    return acc;
  },
  {} as Record<string, BadgeDef>
);
