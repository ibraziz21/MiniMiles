// e.g. src/lib/badges.ts (icon imports are examples)
import s1uActive from "@/public/svg/badges/s1u-active.svg";
import s1uInactive from "@/public/svg/badges/s1u-inactive.svg";
import cel2Active from "@/public/svg/badges/cel2-active.svg";
import cel2Inactive from "@/public/svg/badges/cel2-inactive.svg";
import lamActive from "@/public/svg/badges/lam-active.svg";
import lamInactive from "@/public/svg/badges/lam-inactive.svg";
import amgActive from "@/public/svg/badges/amg-active.svg";
import amgInactive from "@/public/svg/badges/amg-inactive.svg";

export const BADGES = [
  {
    key: "S1U",
    title: "Season 1 Transactions",
    description: "Number of transactions on Celo in Season 1",
    activeIcon: s1uActive,
    inactiveIcon: s1uInactive,
    totalSteps: 4,
  },
  {
    key: "CEL2",
    title: "CEL2 Transactions",
    description: "Number of transactions on CEL2",
    activeIcon: cel2Active,
    inactiveIcon: cel2Inactive,
    totalSteps: 4,
  },
  {
    key: "LAM",
    title: "Lifetime AkibaMiles Earned",
    description: "Total Amount of AkibaMiles earned",
    activeIcon: lamActive,
    inactiveIcon: lamInactive,
    totalSteps: 4,
  },
  {
    key: "AMG",
    title: "AkibaMiles Earned from Games",
    description: "Total Amount of AkibaMiles earned from Games",
    activeIcon: amgActive,
    inactiveIcon: amgInactive,
    totalSteps: 4,
  },
];
