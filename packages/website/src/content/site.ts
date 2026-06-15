export const siteConfig = {
  name: "AkibaMiles",
  title: "AkibaMiles | Turn Everyday Wallet Activity Into Real Rewards",
  description:
    "AkibaMiles is a loyalty and engagement platform with 300K users. Earn miles through daily activity, quests, and stablecoin activity — then spend them on raffles, vouchers, and real prizes.",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.akibamiles.com",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.akibamiles.com",
  email: "hello@akibamiles.com",
  xUrl: "https://x.com/Akibamiles",
  telegramUrl: "https://t.me/+sdAigcRrq2AxYjc8",
};

export const navLinks = [
  { label: "Hub", href: "/hub" },
  { label: "Rewards", href: "/rewards" },
  { label: "Partners", href: "/partners" },
  { label: "Merchants", href: "/merchants" },
  { label: "About", href: "/about" },
];

export const homeContent = {
  hero: {
    eyebrow: "300K users. 20K active every week.",
    title: "Turn everyday wallet activity into real rewards.",
    body:
      "AkibaMiles is a loyalty and engagement platform for stablecoin users. Every transfer, quest, and daily challenge earns miles — spend them on raffles, vouchers, and prizes you actually want.",
    primaryCta: "Start Earning",
    secondaryCta: "Partner with us",
  },
  audiences: {
    eyebrow: "Three audiences, one ecosystem",
    title: "Built for users, merchants, and projects.",
    body: "AkibaMiles connects an active user base with the businesses and projects that want to reach them — through rewards, campaigns, and real incentives.",
    cards: [
      {
        audience: "For users",
        title: "Earn from what you already do.",
        body: "Daily activity, stablecoin transfers, partner quests, streaks, and vault deposits all generate AkibaMiles. Spend them on raffles, games, and real prizes — nothing purchased.",
        cta: "See rewards",
        href: "/rewards",
      },
      {
        audience: "For merchants",
        title: "List products. Get customers. Get paid.",
        body: "The complete commerce service. Get customers delivered through games and rewards, fulfil orders from one dashboard, and receive automatic monthly payouts. From $20/mo + 2%.",
        cta: "Merchant details",
        href: "/merchants",
      },
      {
        audience: "For projects",
        title: "Behavior, not just completions.",
        body: "Run quest campaigns and sponsored raffles that build repeat on-chain activity — not one-time farms. Start with a $100 7-day Growth Test. Scale on signal.",
        cta: "Campaign details",
        href: "/partners#projects",
      },
    ],
  },
  platform: {
    eyebrow: "One loop, many surfaces",
    title: "Earn, spend, and return.",
    body:
      "AkibaMiles is built around repeat participation. Users earn through meaningful daily behavior, spend on rewards they want, and come back for the next opportunity.",
  },
  productCards: [
    {
      title: "Earn Miles",
      body: "Send stablecoins, hit daily streaks, complete partner quests, deposit into the Akiba Vault, or join community campaigns — every action builds your balance.",
      image: "/webflow/earn-miles.png",
      alt: "AkibaMiles earn screen mockup",
    },
    {
      title: "Spend Miles",
      body: "Enter stablecoin prize pools, unlock merchant vouchers, and play games like Akiba Dice. Every spend is powered by miles you earned — nothing purchased.",
      image: "/webflow/spend-miles.png",
      alt: "AkibaMiles spend and rewards mockups",
    },
    {
      title: "Get Rewarded",
      body: "Win cUSD, smartphones, laptops, PS5 consoles, home appliances, and more. Prize pools are funded by real partner campaigns — not a marketing gimmick.",
      image: "/webflow/get-rewarded.png",
      alt: "AkibaMiles reward pop-up mockup",
    },
  ],
  partnerBand: {
    eyebrow: "Merchants and projects",
    title: "Two ways to work with AkibaMiles.",
    body:
      "Merchants subscribe to list products and receive customers through games and rewards. Projects run performance campaigns to move KPIs on a pay-per-action model.",
  },
};

export const rewardContent = {
  hero: {
    eyebrow: "Consumer rewards",
    title: "Your daily activity is finally worth something.",
    body:
      "AkibaMiles rewards the behaviors that strengthen the ecosystem — sending money, completing challenges, holding stablecoins. Turn that activity into entries for prizes you can actually use.",
  },
  steps: [
    {
      title: "Do what you already do",
      body: "Daily transfers, stablecoin activity, partner quests, social challenges, and streak bonuses all generate AkibaMiles. No extra steps — just use MiniPay.",
    },
    {
      title: "Stack your miles",
      body: "Miles accumulate over time. Deposit USDT into the Akiba Vault to earn daily on your balance. The more you participate, the more opportunities you create.",
    },
    {
      title: "Win real things",
      body: "Spend your miles on raffle entries, merchant vouchers, and game sessions. Raffles and campaigns reset regularly — there is always a next chance.",
    },
  ],
  featureBlocks: [
    {
      title: "Raffles and real prizes",
      body: "Enter draws for cUSD, USDT, smartphones, laptops, PlayStation 5, JBL speakers, cameras, smart TVs, gaming chairs, and home appliances. New prize pools launch with every partner campaign.",
    },
    {
      title: "Games with Miles",
      body: "Akiba Dice and other game surfaces turn your miles into repeatable reward moments. Simple enough for first-timers, engaging enough to keep you coming back.",
    },
    {
      title: "Akiba Vault",
      body: "Deposit USDT and earn AkibaMiles daily based on your vault balance. A passive earning layer on top of your existing stablecoin activity.",
    },
    {
      title: "Badges and progress",
      body: "Build a verifiable record across the ecosystem. Badges, achievements, and profile milestones carry across quests, games, and partner campaigns.",
    },
  ],
  prizes: [
    "cUSD & USDT",
    "Smartphones",
    "Laptops",
    "PlayStation 5",
    "Smart TVs",
    "JBL Speakers",
    "Cameras",
    "Gaming Chairs",
    "Home Appliances",
    "Merchant Vouchers",
    "Nintendo Switch",
    "Gaming Accessories",
  ],
};

export const partnerContent = {
  hero: {
    eyebrow: "Merchants and growth partners",
    title: "Sell more. Run campaigns. Reach our users.",
    body:
      "Two ways to work with AkibaMiles. Merchants list products and get customers delivered through games and rewards. Projects run performance campaigns to move real KPIs.",
  },
  audienceStats: [
    { value: "300K", label: "Total lifetime users" },
    { value: "20K", label: "Weekly active users" },
  ],

  merchant: {
    eyebrow: "For merchants",
    title: "Sell more. Get paid your way.",
    body: "The complete commerce service for merchants. List your products, get customers delivered through games and rewards, fulfil orders, and receive automatic monthly payouts.",
    pricing: {
      note: "Flat & simple pricing",
      plans: [
        {
          tier: "Starter",
          name: "Listing",
          price: "$20",
          fee: "+ 2% of completed sales",
          features: [
            "Full store & product listing",
            "Complete order management",
            "Create your own vouchers",
            "Automatic monthly payouts",
            "Finance & billing dashboard",
          ],
        },
        {
          tier: "Most popular",
          name: "Growth",
          price: "$50",
          fee: "+ 2% of completed sales",
          features: [
            "Everything in Listing, plus:",
            "Claw-game voucher campaigns",
            "Priority placement in-app",
            "Full analytics & city insights",
            "Team accounts & roles",
            "CSV exports & receipts",
          ],
        },
        {
          tier: "Scale",
          name: "Commerce",
          price: "$120",
          fee: "+ 1.5% on sales",
          features: [
            "Everything in Growth, plus:",
            "Lowest service fee (1.5%)",
            "Featured storefront placement",
            "Dedicated account support",
            "Priority claw-campaign slots",
            "Custom payout scheduling",
          ],
        },
      ],
      footnote: "Your payout = completed sales − fees. The service fee only applies to orders that complete.",
    },
    howItWorks: [
      { step: "01", title: "Pick a plan and set up your store", body: "Choose your subscription tier, list your products, and configure your first vouchers from the merchant dashboard." },
      { step: "02", title: "Get customers from games and rewards", body: "Users win your vouchers through the Claw Game and raffle campaigns. Motivated buyers arrive at your store ready to purchase." },
      { step: "03", title: "Fulfil and get paid monthly", body: "Accept, pack, and dispatch orders from one dashboard. Automatic monthly payouts to your crypto wallet, bank, or M-Pesa." },
    ],
    payoutMethods: ["Crypto wallet (cUSD)", "Bank transfer", "M-Pesa"],
  },

  project: {
    eyebrow: "For projects and growth teams",
    title: "Turn reward budgets into sustained on-chain activity.",
    body: "Most campaigns optimise for completions. AkibaMiles is built for behavior — repeat transactions, retained balances, and daily engagement that outlasts the campaign window.",
    problem: "Most campaigns: wallets pour in → tasks completed → rewards claimed → activity drops. You paid for a spike, not a user.",
    differentiators: [
      {
        title: "Probabilistic rewards",
        body: "Raffles and games create anticipated value without guaranteed payout. A $25 prize pool drives participation equivalent to $200+ in direct payouts — you fund a prize many compete for.",
      },
      {
        title: "Behavior is the prerequisite",
        body: "Miles can't be sold, traded, or cashed out. The only way to extract value is to play — and the only way to play is to keep using the protocol. The loop doesn't break at the claim step.",
      },
      {
        title: "Streak mechanics build habits",
        body: "Streaks, boosts, and time-gated multipliers train daily engagement. A user with a 7-day streak has a behavioral anchor — breaking it has perceived cost.",
      },
      {
        title: "Measurable at every stage",
        body: "Every campaign produces repeat users, cost per active user, transaction frequency, and D7/D14/D30 retention rates. Not just a completion count.",
      },
    ],
    mechanics: [
      {
        name: "Partner Quests",
        tag: "Performance incentives",
        body: "Define the on-chain or off-chain action — swap, deposit, hold, bridge, app usage. Users complete it, earn miles, and re-engage to accumulate more. Streaks and boosts drive frequency.",
        bullets: ["KPI-mapped: volume, frequency, TVL, DAU", "Streak and time-gated boost mechanics", "D7/D14/D30 retention reporting"],
      },
      {
        name: "Sponsored Raffles",
        tag: "Acquisition & retention",
        body: "Fund a prize pool — we run the raffle. Entry is gated by quest completion, so only users who took your target action can participate. Casual claimers are excluded by design.",
        bullets: ["Behaviour gates raffle access", "More tickets per more completions — rewards frequency", "Cash, airtime, and protocol token prizes"],
      },
    ],
    pilotPricing: [
      {
        tier: "Entry · validate first",
        name: "7-Day Growth Test",
        price: "$100",
        priceNote: "one-time · no commitment",
        rewardPool: null,
        platformFee: null,
        features: [
          "Designed to validate, not to scale",
          "7-day campaign window",
          "1–2 quests targeting a single KPI",
          "Quest + raffle setup, fully managed",
          "Post-campaign results report",
          "Benchmark data for scaling decision",
        ],
        popular: false,
        note: "The $100 test gives you enough signal to justify a full campaign — not full-campaign results on a test budget.",
      },
      {
        tier: "Standard · core product",
        name: "Full Campaign",
        price: "$1,000+",
        priceNote: "2–4 week campaigns",
        rewardPool: null,
        platformFee: null,
        features: [
          "Optimised for measurable, sustained impact",
          "Full quest + reward design",
          "Streak and boost mechanics",
          "Weekend multiplier config",
          "Deeper analytics and attribution",
          "D7 / D14 / D30 retention reporting",
        ],
        popular: true,
        note: null,
      },
    ],
    pilotFootnote: "100% of the reward pool goes directly to users. AkibaMiles earns only the platform fee — our incentive is to make your campaign perform.",
    kpis: ["Repeat users ↑", "Transaction volume ↑", "Wallet balance (TVL) ↑", "Cost per active user ↓", "D7 / D14 retention ↑"],
    proofStats: [
      { value: "1.39M+", label: "Quest claims across all campaigns" },
      { value: "+21%", label: "User growth in one 12-day campaign" },
      { value: "$388K+", label: "TVL held across savings tiers" },
      { value: "14,378", label: "Unique raffle participants" },
    ],
  },

  form: {
    title: "Start the conversation",
    body: "Tell us whether you are a merchant or a project partner, and what you want to launch. We will come back within 2 business days with a clear path forward.",
    email: "hello@akibamiles.com",
  },
};

export const aboutContent = {
  hero: {
    eyebrow: "About AkibaMiles",
    title: "A loyalty layer built on real user behavior.",
    body:
      "AkibaMiles was built to make digital activity worth something. With 300K users and 20K active every week, we connect an engaged user base with the merchants and projects that want to reach them.",
  },
  principles: [
    {
      title: "Miles are earned, never sold",
      body: "Every AkibaMile in circulation came from a user doing something in the ecosystem — a transfer, a quest, a streak. We do not sell points.",
    },
    {
      title: "Partners see real results",
      body: "Campaigns connect to real behavior — not impressions. Every voucher has a redemption. Every quest has a completion. Partners see exactly what happened.",
    },
    {
      title: "The loop stays honest",
      body: "Earn, spend, win, return. Simple enough for a first-time user. Deep enough to reward consistent participation over time.",
    },
  ],
  builtBy: {
    title: "Built by EcoLabs.",
    body: "AkibaMiles is a loyalty and engagement platform with 300K users earning and spending miles across quests, raffles, games, merchant campaigns, and partner activations. We built the engagement layer — rewarding activity, driving retention, and giving merchants and projects a real way to reach an active audience.",
  },
  surfaces: [
    "Daily Quests",
    "Stablecoin Vault",
    "Raffles",
    "Games",
    "Partner Campaigns",
    "Merchant Dashboard",
    "Badges & Profiles",
    "Community Challenges",
  ],
  disclaimer:
    "AkibaMiles is built by EcoLabs and is not operated by MiniPay or Opera.",
};

export const faqs = [
  {
    question: "What is AkibaMiles?",
    answer:
      "AkibaMiles is a loyalty and engagement platform built on top of MiniPay. Users earn miles through daily stablecoin activity and spend them on raffles, merchant vouchers, games, and real prizes.",
  },
  {
    question: "How do I earn AkibaMiles?",
    answer:
      "You earn through daily transfers, stablecoin activity, partner quests, streaks, and community challenges. You can also deposit USDT into the Akiba Vault to earn miles daily on your balance.",
  },
  {
    question: "What can I win?",
    answer:
      "Prize pools include cUSD, USDT, smartphones, laptops, PlayStation 5, smart TVs, JBL speakers, cameras, home appliances, and merchant-sponsored products. New campaigns launch regularly.",
  },
  {
    question: "Are AkibaMiles ever sold?",
    answer:
      "No. AkibaMiles are earned through participation — never purchased. Every mile in circulation was generated by real user activity in the ecosystem.",
  },
  {
    question: "What can merchants do with AkibaMiles?",
    answer:
      "Merchants get a dedicated dashboard to create voucher campaigns — free items, percentage discounts, or fixed deals. They set redemption costs in miles, manage team access, and track orders and campaign performance in real time.",
  },
  {
    question: "Is AkibaMiles operated by MiniPay or Opera?",
    answer:
      "No. AkibaMiles is built and operated by EcoLabs, independently of MiniPay and Opera. The product is designed specifically for the MiniPay user base.",
  },
];
