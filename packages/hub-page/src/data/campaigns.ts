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
    cta: "Open App to Check Eligibility",
    ctaHref: "https://app.akibamiles.com",
  },

  // ─── Partner Quests ────────────────────────────────────────────────────────
  {
    id: "pretium",
    title: "Pretium Quests",
    partner: "Pretium",
    category: "Partner Quests",
    status: "live",
    tagline: "3 actions, up to 100 Miles + a $10 daily raffle for a week",
    description:
      "Complete three Pretium actions through Akiba and stack rewards. Sign up with code AKIBA1 (50 Miles), make your first transaction (50 Miles), and get entered into a $10 USDT daily draw running for one week. Miles are verified by Pretium and paid within 24 hours.",
    details: [
      { label: "Sign up (code AKIBA1)", value: "50 AkibaMiles" },
      { label: "First transaction", value: "50 AkibaMiles" },
      { label: "Daily raffle", value: "$10 USDT · 1 winner/day for 1 week" },
      { label: "Raffle entry", value: "Complete the quests above" },
      { label: "Miles payout", value: "Within 24h of Pretium verification" },
    ],
    cta: "View Pretium Quests in App",
    ctaHref: "https://app.akibamiles.com",
  },

  // ─── Games ─────────────────────────────────────────────────────────────────
  {
    id: "crackpot",
    title: "CrackPot — Jackpot Code Game",
    partner: "AkibaMiles",
    category: "Games",
    status: "coming-soon",
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
    status: "live",
    tagline: "Electronics delivered to your door. Pay with supported methods and earn eligible rewards.",
    description:
      "Browse Leshan Group's electronics catalogue — devices, accessories, and services. Pay with supported methods and earn AkibaMiles when your purchase qualifies for an active merchant reward. Apply vouchers at checkout for discounts. Urban delivery in 1–2 days from $3.",
    details: [
      { label: "Category", value: "Electronics — devices, accessories, services" },
      { label: "Payment", value: "M-Pesa or supported stablecoins" },
      { label: "Rewards", value: "Issued after verified eligible purchases" },
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
    tagline: "New ways to earn AkibaMiles are being added.",
    description:
      "This section will list rewarded actions — things you can do in the Akiba ecosystem to earn Miles outside of quests and games. Nothing active right now, but stay tuned.",
    details: [{ label: "Status", value: "Coming soon" }],
    cta: "Open App",
    ctaHref: "https://app.akibamiles.com",
  },
];
