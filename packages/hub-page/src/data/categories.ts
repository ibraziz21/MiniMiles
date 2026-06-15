export interface Category {
  id: string;
  label: string;
  description: string;
  icon: string;
  href: string;
}

export const categories: Category[] = [
  {
    id: "minipay-rewards",
    label: "MiniPay Rewards",
    description: "Campaigns for MiniPay wallet holders — earn from your cUSD and USDT balance.",
    icon: "💳",
    href: "https://app.akibamiles.com",
  },
  {
    id: "base-campaigns",
    label: "Base Campaigns",
    description: "Quests and rewards for verified actions across Base ecosystem projects.",
    icon: "🔵",
    href: "https://app.akibamiles.com",
  },
  {
    id: "partner-quests",
    label: "Partner Quests",
    description: "Complete tasks from Akiba partners and earn Miles for every verified action.",
    icon: "🎯",
    href: "https://app.akibamiles.com",
  },
  {
    id: "games",
    label: "Games",
    description: "Play skill-based games and compete on leaderboards to win reward pools.",
    icon: "🎮",
    href: "https://app.akibamiles.com",
  },
  {
    id: "raffles",
    label: "Raffles",
    description: "Use AkibaMiles to enter draws for cash, devices, and partner-sponsored prizes.",
    icon: "🎟️",
    href: "https://app.akibamiles.com",
  },
  {
    id: "vouchers",
    label: "Vouchers",
    description: "Redeem Miles for merchant vouchers and real-world discounts.",
    icon: "🏷️",
    href: "https://app.akibamiles.com",
  },
  {
    id: "promos",
    label: "Promos",
    description: "Limited-time promotional offers from Akiba and partner brands.",
    icon: "⚡",
    href: "https://app.akibamiles.com",
  },
  {
    id: "merchant-offers",
    label: "Merchant Offers",
    description: "Exclusive deals from Akiba-connected merchants across everyday categories.",
    icon: "🛍️",
    href: "https://app.akibamiles.com",
  },
];
