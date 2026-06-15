const MINIPAY_APP_LINK = "https://play.google.com/store/apps/details?id=com.opera.minipay";

export type CampaignStatus = "live" | "starting-soon" | "coming-soon";
export type CampaignCategory =
  | "Wallet Rewards"
  | "Partner Quests"
  | "Games"
  | "Merchants & Vouchers"
  | "Rewards";

export interface CampaignDetail {
  label: string;
  value: string;
}

export interface Campaign {
  id: string;
  title: string;
  partner: string;
  category: CampaignCategory;
  status: CampaignStatus;
  /** Big reward number shown top-right of the card e.g. "$50/day" */
  rewardHighlight: string;
  /** Subtle label under the highlight e.g. "daily pool" */
  rewardLabel: string;
  tagline: string;
  description: string;
  details: CampaignDetail[];
  cta: string;
  ctaHref: string;
}

export const campaigns: Campaign[] = [
  // ─── Wallet Rewards ────────────────────────────────────────────────────────
  {
    id: "june-minipay-rewards",
    title: "June MiniPay Rewards",
    partner: "MiniPay × AkibaMiles",
    category: "Wallet Rewards",
    status: "live",
    rewardHighlight: "$50",
    rewardLabel: "daily pool",
    tagline: "$50 USDT daily — 10 winners every day in June",
    description:
      "Hold at least $10 USDT in your MiniPay wallet to qualify. Every day in June, 10 wallets are drawn and share a $50 USDT reward pool — $5 USDT each. Use your earned AkibaMiles to buy campaign tickets for more daily entries.",
    details: [
      { label: "Daily pool", value: "$50 USDT" },
      { label: "Winners/day", value: "10" },
      { label: "Per winner", value: "$5 USDT" },
      { label: "Entry requirement", value: "Hold ≥$10 USDT in MiniPay" },
      { label: "How to enter", value: "Use AkibaMiles for tickets" },
      { label: "Duration", value: "All of June 2025" },
    ],
    cta: "Open in MiniPay",
    ctaHref: MINIPAY_APP_LINK,
  },

  // ─── Partner Quests ────────────────────────────────────────────────────────
  {
    id: "pretium",
    title: "Pretium Quests",
    partner: "Pretium",
    category: "Partner Quests",
    status: "live",
    rewardHighlight: "$10",
    rewardLabel: "daily raffle",
    tagline: "3 actions, up to 100 Miles + a $10 daily raffle for a week",
    description:
      "Complete three Pretium actions through Akiba and stack rewards. Sign up with code AKIBA1 (50 Miles), make your first transaction (50 Miles), and get entered into a $10 USDT daily draw running for one week. Miles are verified by Pretium and paid within 24 hours.",
    details: [
      { label: "Sign up (code AKIBA1)", value: "50 Miles" },
      { label: "First transaction", value: "50 Miles" },
      { label: "Daily raffle", value: "$10 USDT · 1 winner/day for 1 week" },
      { label: "Raffle entry", value: "Complete the quests above" },
      { label: "Miles payout", value: "Within 24h of Pretium verification" },
    ],
    cta: "Start Quests in MiniPay",
    ctaHref: MINIPAY_APP_LINK,
  },

  // ─── Games ─────────────────────────────────────────────────────────────────
  {
    id: "pvp-farkle",
    title: "PvP Farkle",
    partner: "AkibaMiles Games",
    category: "Games",
    status: "coming-soon",
    rewardHighlight: "$0.15",
    rewardLabel: "USDT per duel win",
    tagline: "Head-to-head dice duels — roll, bank, and outlast your opponent.",
    description:
      "PvP Farkle is a two-player dice duel. Players take turns rolling, scoring, and banking points. The first player to reach the target score wins. Play in Miles mode using Farkle tickets, or enter Reward Duels with USDT for real stakes.",
    details: [
      { label: "Miles entry", value: "25 Miles for 5 tickets · 1 ticket/match" },
      { label: "Miles win reward", value: "10 Miles" },
      { label: "Miles consolation", value: "5 Miles (loser)" },
      { label: "USDT entry", value: "$0.50 USDT for 5 credits · 1 credit/Reward Duel" },
      { label: "USDT win reward", value: "$0.15 USDT via GameCreditVault" },
    ],
    cta: "Play Farkle",
    ctaHref: "https://app.akibamiles.com/rush",
  },
  {
    id: "crackpot",
    title: "CrackPot — Jackpot Code Game",
    partner: "AkibaMiles",
    category: "Games",
    status: "coming-soon",
    rewardHighlight: "up to $50",
    rewardLabel: "max jackpot",
    tagline: "Crack a 4-symbol Mastermind code before anyone else. Take the pot.",
    description:
      "A Mastermind-style jackpot game. Every failed attempt feeds the pot. The first player to crack the code wins everything. Miles version runs every 24 hours with a 200 Miles seed pot. A USDT version ($0.10/attempt, $2 seed) is coming once licensing is in place.",
    details: [
      { label: "Miles version", value: "10 Miles/attempt, 200 Miles seed" },
      { label: "Pot cap", value: "10,000 Miles" },
      { label: "USDT version", value: "$0.10/attempt, $2 seed (coming soon)" },
      { label: "Mechanic", value: "4-position Mastermind, 6 symbols" },
      { label: "Cycle", value: "24h (Miles) / 8h (USDT)" },
    ],
    cta: "Notify Me",
    ctaHref: "https://app.akibamiles.com",
  },

  // ─── Merchants & Vouchers ──────────────────────────────────────────────────
  {
    id: "leshan-group",
    title: "Leshan Group",
    partner: "Leshan Group",
    category: "Merchants & Vouchers",
    status: "coming-soon",
    rewardHighlight: "70% off",
    rewardLabel: "vouchers coming",
    tagline: "Electronics delivered to your door. Pay in USDT, earn 200 Miles.",
    description:
      "Browse Leshan Group's electronics catalogue — devices, accessories, and services. Pay in cUSD or USDT on Celo. Earn 200 AkibaMiles per order. Apply vouchers at checkout for discounts. Urban delivery in 1–2 days from $3.",
    details: [
      { label: "Category", value: "Electronics — devices, accessories, services" },
      { label: "Payment", value: "cUSD or USDT on Celo" },
      { label: "Miles per order", value: "200 Miles" },
      { label: "Urban delivery", value: "$3.00 · 1–2 days (Nairobi, Mombasa)" },
      { label: "Other towns", value: "$5.00 · 3–5 days" },
      { label: "Vouchers", value: "Apply Miles-backed vouchers at checkout" },
    ],
    cta: "Shop in App",
    ctaHref: "https://app.akibamiles.com/spend",
  },

  // ─── Rewards (placeholder) ─────────────────────────────────────────────────
  {
    id: "rewards-coming-soon",
    title: "New Reward Actions",
    partner: "AkibaMiles",
    category: "Rewards",
    status: "coming-soon",
    rewardHighlight: "Soon",
    rewardLabel: "new actions",
    tagline: "New ways to earn AkibaMiles are being added.",
    description:
      "This section will list rewarded actions — things you can do in the Akiba ecosystem to earn Miles outside of quests and games. Nothing active right now, but stay tuned.",
    details: [{ label: "Status", value: "Coming soon" }],
    cta: "Open App",
    ctaHref: "https://app.akibamiles.com",
  },
];
