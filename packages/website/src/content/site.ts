export const siteConfig = {
  name: "AkibaMiles",
  title: "Akiba | Shopping Should Be Rewarding",
  description:
    "Akiba turns everyday shopping into rewards. Earn Miles every time you spend at an Akiba merchant, then redeem vouchers, discounts and rewards across the whole network. Merchants launch loyalty in days — no hardware.",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.akibamiles.com",
  passUrl: process.env.NEXT_PUBLIC_PASS_URL ?? "https://pass.akibamiles.com",
  merchantUrl: process.env.NEXT_PUBLIC_MERCHANT_URL ?? "https://merchant.akibamiles.com",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.akibamiles.com",
  email: "hello@akibamiles.com",
  xUrl: "https://x.com/Akibamiles",
  telegramUrl: "https://t.me/+sdAigcRrq2AxYjc8",
};

export const navLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "For Merchants", href: "/merchants" },
  { label: "About", href: "/about" },
];

export const homeContent = {
  hero: {
    eyebrow: "Loyalty for everyday shopping",
    title: "Shopping should be rewarding.",
    body:
      "Earn Miles every time you spend at an Akiba merchant — then turn them into vouchers, discounts na zawadi. Free to join. 30 seconds to register.",
    primaryCta: "Get your Akiba Pass",
    secondaryCta: "I'm a merchant",
  },
  howItWorks: {
    eyebrow: "How it works",
    title: "Shop. Earn. Redeem.",
    body: "No points math, no punch cards, no expiry. Just the shopping you already do.",
    steps: [
      {
        step: "01",
        title: "Shop like you always do",
        body: "Pay at any Akiba merchant — electronics, groceries, fuel, pharmacy, repairs. Nothing extra to do at the counter.",
      },
      {
        step: "02",
        title: "Earn Miles instantly",
        body: "The merchant scans your Akiba Pass and Miles land before you leave the shop. Every shilling you spend counts.",
      },
      {
        step: "03",
        title: "Redeem real rewards",
        body: "Turn Miles into vouchers and discounts at any merchant in the network — not just the one where you earned them.",
      },
    ],
  },
  merchantBand: {
    eyebrow: "For merchants",
    title: "Your customers shop with you today. Akiba brings them back tomorrow.",
    body:
      "Launch a loyalty program in days — no hardware, no POS integration. Set your reward rate, scan to award, and watch repeat visits grow. You only pay on completed sales.",
    cta: "Become an Akiba merchant",
  },
  miniApp: {
    eyebrow: "Akiba Mini-App on MiniPay",
    title: "Already on MiniPay? Play on.",
    body:
      "The Akiba Mini-App is where 300K users complete quests, enter raffles, and win real prizes — smartphones, laptops, cUSD and more. Your Miles work there too.",
    cta: "Open Mini-App",
  },
  proofStats: [
    { value: "300K", label: "Lifetime users" },
    { value: "20K", label: "Active every week" },
    { value: "1.39M+", label: "Rewards claimed" },
  ],
};

export const faqs = [
  {
    question: "What is Akiba?",
    answer:
      "Akiba is a loyalty network for everyday shopping in Kenya. You earn Miles every time you spend at a participating merchant, and redeem them for vouchers, discounts and rewards — at any merchant in the network, not just one store.",
  },
  {
    question: "How do I start earning?",
    answer:
      "Get your Akiba Pass — it takes about 30 seconds. Then shop at any Akiba merchant, have them scan your Pass at the counter, and Miles land instantly. Hakuna app ya lazima, hakuna forms ndefu.",
  },
  {
    question: "What can I redeem Miles for?",
    answer:
      "Merchant vouchers and discounts on your next purchase, plus rewards from network campaigns. Miles are portable — earn at one shop, spend at another.",
  },
  {
    question: "Do Miles expire?",
    answer:
      "No. Your Miles stay yours until you spend them, and your balance grows across every Akiba merchant you shop at.",
  },
  {
    question: "How does it work for merchants?",
    answer:
      "You set a reward rate, scan customer passes at the point of sale, and Akiba handles the rest — issuance, redemption, and a dashboard showing repeat-customer behaviour. No hardware, no integration project, and you only pay on completed sales.",
  },
  {
    question: "Is Akiba operated by MiniPay or Opera?",
    answer:
      "No. Akiba is built and operated by Akiba Ecosystems Ltd, independently of MiniPay and Opera. The Akiba Mini-App runs on MiniPay as a distribution surface, but it is not affiliated with or operated by them.",
  },
];

export const rewardContent = {
  hero: {
    eyebrow: "Consumer rewards",
    title: "Every purchase earns something back.",
    body:
      "Akiba issues instant, merchant-funded Miles every time you spend at an Akiba merchant — no points math, no expiry, no minimum. Spend Miles across the whole network on rewards you actually want.",
  },
  steps: [
    {
      title: "Shop at Akiba merchants",
      body: "Every qualifying purchase at a participating merchant — grocery, fuel, pharmacy, airtime, fast food — issues instant Miles. Nothing extra to do.",
    },
    {
      title: "Stack your Miles",
      body: "Miles accumulate and are portable across the whole network. Also earn through partner quests, daily challenges, and streaks in the Mini-App.",
    },
    {
      title: "Win real things",
      body: "Spend Miles on raffle entries, merchant vouchers, and game sessions. Prize pools are funded by real merchant campaigns — cUSD, smartphones, laptops, and more.",
    },
  ],
  featureBlocks: [
    {
      title: "Raffles and real prizes",
      body: "Enter draws for cUSD, USDT, smartphones, laptops, PlayStation 5, JBL speakers, cameras, smart TVs, gaming chairs, and home appliances. New prize pools launch with every partner campaign.",
    },
    {
      title: "Games with Miles",
      body: "Akiba Dice and other game surfaces turn your Miles into repeatable reward moments. Simple enough for first-timers, engaging enough to keep you coming back.",
    },
    {
      title: "Akiba Vault",
      body: "Deposit USDT and earn Miles daily based on your vault balance. A passive earning layer on top of your existing stablecoin activity.",
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
    title: "Run loyalty. Drive campaigns. Reach our users.",
    body:
      "Two ways to work with Akiba. Merchants fund instant rewards on everyday purchases and pay only when transactions happen. Projects run performance campaigns to move real KPIs against 300K users.",
  },
  audienceStats: [
    { value: "300K", label: "Total lifetime users" },
    { value: "20K", label: "Weekly active users" },
  ],

  merchant: {
    eyebrow: "For merchants",
    title: "Loyalty that brings them back.",
    body: "Akiba Scan & Award rewards your customers instantly on every purchase. Set your reward rate, scan at the counter, and track repeat spend from one dashboard — no hardware, no integration project.",
    pricing: {
      note: "Flat & simple pricing",
      plans: [
        {
          tier: "Starter",
          name: "Listing",
          price: "Ksh 2,500",
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
          price: "Ksh 5,000",
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
          price: "Ksh 10,000",
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
      { step: "01", title: "Set your reward rate", body: "Onboard via the merchant dashboard, configure your qualifying spend categories, and set the reward rate you want to offer customers. No hardware to install." },
      { step: "02", title: "Scan to award", body: "Customer pays, you scan their Akiba Pass — Miles land in their account before they leave the counter. Works with M-Pesa and connected payment methods." },
      { step: "03", title: "Watch them come back", body: "Your dashboard shows repeat-customer rate, spend per visit, and full settlement reporting. You only pay for transactions that actually happened." },
    ],
    payoutMethods: ["M-Pesa", "Bank transfer", "Crypto wallet (cUSD)"],
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
    eyebrow: "About Akiba",
    title: "Kenya's first native onchain loyalty network.",
    body:
      "Akiba is merchant-funded, mobile-money-embedded rewards — portable across every merchant in the network. Lower settlement cost means more value handed back to customers. We win on the two things legacy points programs can't do: relationship depth and interoperability.",
  },
  principles: [
    {
      title: "Miles come from real spend",
      body: "Every Mile in circulation was funded by a merchant against a real purchase event. We don't manufacture engagement to generate Miles — frequency comes from transactions, not tricks.",
    },
    {
      title: "Portability is the product",
      body: "A loyalty program where miles only work at one merchant is a discount scheme. Miles that work everywhere turn individual merchant relationships into a network. That's what we're building.",
    },
    {
      title: "The economics are honest",
      body: "Merchants pay to defend share-of-wallet. Customers get back value from their own spend. The onchain ledger is immutable and auditable. Nothing is hidden.",
    },
  ],
  builtBy: {
    title: "Built by Akiba Ecosystems Ltd.",
    body: "Akiba is Kenya's onchain loyalty network — 300K users, merchant-funded rewards on everyday spend, and a platform API that lets any app or fintech embed the full loyalty stack. We started with engagement mechanics on MiniPay, learned what drives retention, and are now building the infrastructure the thesis actually requires.",
  },
  surfaces: [
    "Scan & Award",
    "Akiba Pass",
    "Merchant Dashboard",
    "Platform API",
    "Onchain Ledger",
    "Partner Quests",
    "Raffles & Games",
    "MiniPay Mini-App",
  ],
  disclaimer:
    "Akiba is built by Akiba Ecosystems Ltd and is not operated by MiniPay or Opera.",
};
