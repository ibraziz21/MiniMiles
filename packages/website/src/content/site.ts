export const siteConfig = {
  name: "AkibaMiles",
  title: "Akiba | Find the good places. Get rewarded for going.",
  description:
    "Find shops near you, earn Miles when you spend, and turn them into discounts. Businesses get discovered and earn the second visit. No hardware.",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.akibamiles.com",
  passUrl: process.env.NEXT_PUBLIC_PASS_URL ?? "https://pass.akibamiles.com",
  merchantUrl: process.env.NEXT_PUBLIC_MERCHANT_URL ?? "https://merchant.akibamiles.com",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.akibamiles.com",
  email: "hello@akibamiles.com",
  xUrl: "https://x.com/Akibamiles",
  telegramUrl: "https://t.me/+OkPgZhxDj8plNTA8",
};

export const navLinks = [
  { label: "What you get", href: "/#what-you-get" },
  { label: "Get the app", href: "/#app" },
  { label: "For Merchants", href: "/merchants" },
  { label: "About", href: "/about" },
];

/**
 * The five things Akiba does for a shopper, in the order they happen.
 * Each screenshot is a shipped screen, not a mockup: Merchants, Rewards,
 * Shop, a merchant profile and the Business offers deck.
 */
export const pillars = [
  {
    id: "discover",
    step: "01",
    eyebrow: "Discover",
    title: "Discover new places to shop",
    body: "See what's around you. Food, fuel, groceries, beauty, repairs.",
    points: [
      "Filter by category or by what's nearest",
      "Opening hours and distance on every shop",
      "Directions, call or WhatsApp in one tap",
    ],
    image: { src: "/app/merchants.webp", alt: "The Akiba merchant directory, with category and city filters" },
  },
  {
    id: "earn",
    step: "02",
    eyebrow: "Earn",
    title: "Earn Miles for shopping",
    body: "Pay the way you always do. Your Miles land before you leave the counter.",
    points: [
      "Instant at the till",
      "Earn at one shop, spend at another",
      "Miles never expire",
    ],
    image: { src: "/app/rewards.webp", alt: "The Akiba rewards screen showing an AkibaMiles balance" },
  },
  {
    id: "vouchers",
    step: "03",
    eyebrow: "Redeem",
    title: "Get discounts and vouchers",
    body: "Spend your Miles on discounts, or claim free offers that cost nothing.",
    points: [
      "See the Miles price before you confirm",
      "Free offers you can claim with no Miles",
      "More rewards the more you shop at one place",
      "One wallet for everything you've claimed",
    ],
    image: { src: "/app/shop.webp", alt: "Shop with Miles: a voucher priced in AkibaMiles" },
    secondaryImage: { src: "/app/free-offers.webp", alt: "Free offers that need no Miles to claim" },
  },
  {
    id: "recommend",
    step: "04",
    eyebrow: "Recommend",
    title: "Tell people what you loved",
    body: "Shopped somewhere good? Say what you loved and add a photo.",
    points: [
      "Only people who actually bought can post",
      "Real photos, and what to try when you go",
      "Your tip helps the next person choose",
    ],
    image: { src: "/app/merchant-profile.webp", alt: "A merchant profile showing a verified visit recommendation" },
  },
  {
    id: "offers",
    step: "05",
    eyebrow: "Never miss it",
    title: "Get reminded for business offers",
    body: "Shops run offers on set days. Get a nudge before they start.",
    points: [
      "Swipe through what's on",
      "Remind me 30 minutes, an hour, or a day before",
      "See what's live now and what's coming",
      "Most need no Miles",
    ],
    image: { src: "/app/offers.webp", alt: "A business offer with a reminder bell in the Akiba offers deck" },
  },
];

export const homeContent = {
  hero: {
    eyebrow: "Shop. Earn. Recommend.",
    title: "Find the good places. Get rewarded for going.",
    body: "Find shops near you, earn Miles when you spend, and turn them into discounts.",
    primaryCta: "Get your Akiba Pass",
    secondaryCta: "I'm a merchant",
    imageAlt: "The Akiba Explore screen showing business offers and places people loved",
    badge: "iOS & Android app coming soon",
    assurances: ["Free to join", "Miles never expire"],
  },
  whatYouGet: {
    eyebrow: "What you get",
    title: "Five things Akiba does for you.",
  },
  merchantBand: {
    eyebrow: "For businesses",
    title: "Get found. Then get them back.",
    body: "Reach shoppers looking for what you sell, and give them a reason to come back.",
    cta: "Put your business on Akiba",
  },
  app: {
    eyebrow: "Coming soon",
    title: "Akiba is coming to your home screen.",
    body: "iOS and Android, in final testing. Leave your email and we'll tell you when it's out.",
    platforms: [
      { name: "iOS", status: "In final testing" },
      { name: "Android", status: "In final testing" },
    ],
    meanwhile: "Works today in any phone browser",
    meanwhileCta: "Open Akiba",
  },
  miniApp: {
    eyebrow: "Akiba Mini-App on MiniPay",
    title: "Already on MiniPay? Your Miles work there too.",
    body: "Same balance. Earn it shopping, spend it either side.",
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
      "A way to find good places to shop in Kenya and get rewarded for shopping there.",
  },
  {
    question: "How do I start?",
    answer:
      "Get your Akiba Pass. It takes about 30 seconds in your phone browser. Then shop as usual and have the till scan your Pass.",
  },
  {
    question: "What can I use Miles for?",
    answer:
      "Discounts and vouchers at shops on Akiba. You see the Miles price before you confirm. There are also free offers that cost no Miles.",
  },
  {
    question: "Do Miles expire?",
    answer:
      "No. Miles are yours until you spend them. A voucher you claim can have its own end date, shown on the voucher.",
  },
  {
    question: "Who can leave a recommendation?",
    answer:
      "Only someone who actually bought something there. That's why the recommendations are worth reading.",
  },
  {
    question: "How do offer reminders work?",
    answer:
      "Tap the bell on an offer and pick 30 minutes, an hour, or a day ahead. Remove it any time.",
  },
  {
    question: "Is there an Akiba app?",
    answer:
      "Akiba works today in your phone browser. The iOS and Android app is in final testing. Join the list above and we'll tell you when it's out.",
  },
  {
    question: "How does it work for businesses?",
    answer:
      "Set up a profile, pick a plan, and scan customer passes at the till. No hardware, no POS integration.",
  },
  {
    question: "Is Akiba operated by MiniPay or Opera?",
    answer:
      "No. Akiba is built and operated by Akiba Ecosystems Ltd, independently of MiniPay and Opera. The Akiba Mini-App runs on MiniPay but is not affiliated with or operated by them.",
  },
];

export const rewardContent = {
  hero: {
    eyebrow: "Consumer rewards",
    title: "Every purchase earns something back.",
    body:
      "Akiba issues instant, merchant-funded Miles every time you spend at an Akiba merchant. No points math, no expiry, no minimum. Spend Miles across the whole network on rewards you actually want.",
  },
  steps: [
    {
      title: "Shop at Akiba merchants",
      body: "Every qualifying purchase at a participating merchant (grocery, fuel, pharmacy, airtime, fast food) issues instant Miles. Nothing extra to do.",
    },
    {
      title: "Stack your Miles",
      body: "Miles accumulate and are portable across the whole network. Also earn through partner quests, daily challenges, and streaks in the Mini-App.",
    },
    {
      title: "Win real things",
      body: "Spend Miles on raffle entries, merchant vouchers, and game sessions. Prize pools are funded by real merchant campaigns: cUSD, smartphones and laptops.",
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
    title: "Get discovered. Keep them coming back. Reach our users.",
    body:
      "Two ways to work with Akiba. Businesses get found by nearby shoppers and fund instant rewards that earn the second visit. Projects run performance campaigns to move real KPIs against 300K users.",
  },
  audienceStats: [
    { value: "300K", label: "Total lifetime users" },
    { value: "20K", label: "Weekly active users" },
  ],

  merchant: {
    eyebrow: "For businesses",
    title: "Discovery that finds them. Retention that keeps them.",
    body: "Get in front of shoppers searching for what you sell, then give them a reason to come back.",
    /**
     * The merchant side of the five shopper pillars on the home page,
     * same order. `icon` keys map to the lucide set in the merchants page.
     */
    surfaces: [
      {
        icon: "storefront",
        title: "A profile people can find",
        body: "Your categories, branches, hours and photos, in front of shoppers browsing nearby.",
      },
      {
        icon: "counter",
        title: "Rewards at the counter",
        body: "Scan the customer's Pass at the till. You set the rate, your plan caps the spend.",
      },
      {
        icon: "vouchers",
        title: "Vouchers and repeat-customer rewards",
        body: "Discounts priced in Miles, free offers, or rewards that unlock after a few visits.",
      },
      {
        icon: "offers",
        title: "Offer days with reminders",
        body: "Schedule an offer and customers get a nudge before it opens. Fills your quiet shifts.",
      },
      {
        icon: "recommendations",
        title: "Recommendations you earned",
        body: "Photos and tips from customers who actually bought. Nobody else can post.",
      },
    ],
    reasons: [
      {
        title: "Reach people who've never heard of you",
        body: "Shoppers browse by category and by what's nearby, so your profile reaches them first.",
      },
      {
        title: "You set the rate. You control the cost.",
        body: "Pick your reward rate and qualifying spend. Your plan includes a monthly allowance with clear overage pricing.",
      },
      {
        title: "Portability builds the habit",
        body: "Customers are building a balance, not chasing a one-off deal. That's what makes them pick you again.",
      },
      {
        title: "Every reward accounted for",
        body: "Your dashboard shows what was issued, when, and against which sale.",
      },
    ],
    pricing: {
      note: "Subscription plans",
      plans: [
        {
          name: "Standard",
          monthlyPrice: 2500,
          features: [
            "10,000 Miles per usage month",
            "5 active voucher types",
            "Up to 2 branches",
            "KES 0.30 per overage Mile",
            "Recommended for businesses below KES 1,000,000.00 / mo",
          ],
        },
        {
          name: "Growth",
          monthlyPrice: 5000,
          features: [
            "50,000 Miles per usage month",
            "20 active voucher types",
            "Up to 2 branches",
            "KES 0.30 per overage Mile",
            "Recommended for businesses with KES 1,000,000.00 – KES 5,000,000.00 / mo",
          ],
        },
      ],
      footnote: "Prices exclude VAT. Save 5% when billed quarterly or 20% when billed annually.",
      faqs: [
        {
          question: "What does the monthly Miles allowance cover?",
          answer: "It is the number of Miles your merchant account can issue to customers during each monthly usage period.",
        },
        {
          question: "Do unused Miles roll over?",
          answer: "No. Each monthly usage period starts with the allowance included in your plan.",
        },
        {
          question: "What happens when I exceed my allowance?",
          answer: "You can continue issuing Miles. Additional Miles are charged at KES 0.30 each and added to the invoice for your next billing period.",
        },
        {
          question: "How do overages work on quarterly or annual plans?",
          answer: "Your subscription term remains quarterly or annual, but any overage used is invoiced monthly.",
        },
        {
          question: "How are active voucher types counted?",
          answer: "The limit applies across your entire merchant account, including all branches.",
        },
        {
          question: "How do I pay my subscription invoice?",
          answer: "Pay by M-Pesa or bank transfer using the payment details shown on the invoice generated in your merchant dashboard.",
        },
        {
          question: "When will I receive my renewal invoice?",
          answer: "Monthly renewal invoices are issued 7 days before renewal. Quarterly and annual renewal invoices are issued 14 days before renewal, with reminders before and after the due date.",
        },
        {
          question: "What happens if a renewal invoice is late?",
          answer: "You have a 7-day grace period. After grace, new Miles issuance and voucher publishing are paused until the invoice is paid in full. Vouchers already issued to customers remain redeemable.",
        },
        {
          question: "Can I cancel or change my plan?",
          answer: "Cancellation takes effect at the end of your paid term and started terms are not refundable. Upgrades take effect immediately with proration; downgrades take effect at the next renewal.",
        },
      ],
    },
    howItWorks: [
      { step: "01", title: "Set your reward rate", body: "Onboard in the dashboard, pick your qualifying categories, set the rate. No hardware." },
      { step: "02", title: "Scan to award", body: "Customer pays, you scan their Pass, Miles land before they leave the counter." },
      { step: "03", title: "Watch them come back", body: "Repeat-customer rate, spend per visit and Miles usage, all in your dashboard." },
    ],
  },

  project: {
    eyebrow: "For projects and growth teams",
    title: "Turn reward budgets into sustained user activity.",
    body: "Most campaigns optimise for completions. AkibaMiles is built for behavior: repeat transactions, retained balances, and daily engagement that outlasts the campaign window.",
    problem: "Most campaigns: wallets pour in → tasks completed → rewards claimed → activity drops. You paid for a spike, not a user.",
    differentiators: [
      {
        title: "Probabilistic rewards",
        body: "Raffles and games create anticipated value without guaranteed payout. A $25 prize pool drives participation equivalent to $200+ in direct payouts. You fund one prize that many compete for.",
      },
      {
        title: "Behavior is the prerequisite",
        body: "Miles can't be sold, traded, or cashed out. The only way to extract value is to play, and the only way to play is to keep using the protocol. The loop doesn't break at the claim step.",
      },
      {
        title: "Streak mechanics build habits",
        body: "Streaks, boosts, and time-gated multipliers train daily engagement. A user with a 7-day streak has a behavioral anchor, and breaking it has perceived cost.",
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
        body: "Define the action that matters: purchase, deposit, hold, payment, or app usage. Users complete it, earn Miles, and re-engage to accumulate more. Streaks and boosts drive frequency.",
        bullets: ["KPI-mapped: volume, frequency, TVL, DAU", "Streak and time-gated boost mechanics", "D7/D14/D30 retention reporting"],
      },
      {
        name: "Sponsored Raffles",
        tag: "Acquisition & retention",
        body: "Fund a prize pool and we run the raffle. Entry is gated by quest completion, so only users who took your target action can participate. Casual claimers are excluded by design.",
        bullets: ["Behaviour gates raffle access", "More tickets per more completions, rewarding frequency", "Cash, airtime, and protocol token prizes"],
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
        note: "The $100 test gives you enough signal to justify a full campaign, not full-campaign results on a test budget.",
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
    pilotFootnote: "100% of the reward pool goes directly to users. AkibaMiles earns only the platform fee, so our incentive is to make your campaign perform.",
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
    title: "Discovery and retention, built for everyday commerce.",
    body:
      "Two halves of one loop. Shoppers find businesses worth going to and get rewarded for going. Businesses get found, and earn the second visit.",
  },
  principles: [
    {
      title: "Miles come from real spend",
      body: "Every Mile in circulation was funded by a business against a real purchase. Frequency comes from transactions, not tricks.",
    },
    {
      title: "Portability is the product",
      body: "Miles that only work at one shop are just a discount. Miles that work everywhere turn single relationships into a network.",
    },
    {
      title: "Recommendations have to be earned",
      body: "Only a customer who actually bought something is asked to recommend it. No anonymous ratings, no bought reviews.",
    },
    {
      title: "The economics are honest",
      body: "Businesses invest in repeat customers. Customers get value back from their own spend. Every Mile has an auditable record.",
    },
  ],
  builtBy: {
    title: "Built by Akiba Ecosystems Ltd.",
    body: "We connect shoppers with businesses worth visiting and reward the visit. Businesses publish a profile, offers and vouchers from a self-serve dashboard, and the platform API connects vouchers to existing checkout systems.",
  },
  surfaces: [
    "Discovery feed",
    "Merchant profiles",
    "Akiba Pass",
    "Scan & Award",
    "Verified visits",
    "Business offers & reminders",
    "Voucher wallet",
    "Merchant Dashboard",
    "Platform API",
    "Rewards ledger",
    "MiniPay Mini-App",
    "iOS & Android app (soon)",
  ],
  disclaimer:
    "Akiba is built by Akiba Ecosystems Ltd and is not operated by MiniPay or Opera.",
};
