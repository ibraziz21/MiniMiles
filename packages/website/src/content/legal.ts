export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalPage = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
};

export const privacyPolicy: LegalPage = {
  title: "Privacy Policy",
  lastUpdated: "Sep 8, 2026",
  intro:
    "This Privacy Policy explains how Akiba Ecosystems Ltd (\"Akiba\", \"we\") collects, uses, and protects information when you use the Akiba services — including the Akiba Pass, Scan & Award at participating merchants, the Akiba Hub, the Akiba Mini-App on MiniPay, and this website. By using our services or submitting information through this site, you agree to this policy.",
  sections: [
    {
      title: "1. What We Collect",
      paragraphs: [
        "We collect the data necessary to operate the Akiba loyalty network and respond to relevant inquiries.",
      ],
      bullets: [
        "Account details when you register for an Akiba Pass: email address, phone number, and optionally your name, country, and reward interests.",
        "Wallet addresses you link, to assign Miles and track balances.",
        "Purchase reward data when you earn Miles at a participating merchant: the merchant, purchase amount, product category, payment reference, and time of purchase.",
        "Voucher activity in the Akiba Hub and Pass, including Miles spent, vouchers obtained, and voucher redemptions at participating merchants.",
        "Interaction data from the Mini-App and Hub, such as point-earning actions, quest completions, referrals, raffle entries, and voucher redemptions.",
        "Optional profile and social information if you provide it for quests, physical rewards, winner contact, or profile completion.",
        "Business contact details when you submit a merchant or partner inquiry, such as name, email, company, country, website, role, and message.",
      ],
    },
    {
      title: "2. How We Use Your Data",
      bullets: [
        "Assign and track Miles earned from purchases, quests, and other activities.",
        "Operate Scan & Award, including verifying purchases and delivering rewards to your Akiba Pass.",
        "Issue Miles and vouchers, record voucher redemptions, and show loyalty activity in the Akiba Hub, Pass, and merchant dashboard.",
        "Display progress on dashboards, leaderboards, badges, and profiles.",
        "Enable raffle entries, reward distribution, and winner contact.",
        "Review merchant and partner inquiries and respond to business requests.",
        "Improve app performance, safety, fraud prevention, and user experience.",
      ],
    },
    {
      title: "3. What Merchants Can See",
      paragraphs: [
        "Participating merchants can see loyalty activity connected to their own store — such as rewards issued against their sales, redemption of their vouchers, and aggregate repeat-visit patterns. Merchants do not receive your activity at other merchants, your wallet balances, or your full profile.",
      ],
    },
    {
      title: "4. On-Chain Data",
      paragraphs: [
        "Miles are recorded as digital tokens on a public blockchain (Celo). Wallet addresses, Miles balances, and token transactions are publicly visible on that network and, by its nature, cannot be edited or deleted by us. We do not publish your name, email, or phone number on-chain.",
      ],
    },
    {
      title: "5. Cookies and Analytics",
      paragraphs: [
        "Akiba may use basic analytics or anti-abuse tooling to improve functionality and protect forms. Analytics, if enabled, is limited to product improvement and operational safety.",
      ],
    },
    {
      title: "6. Data Security",
      paragraphs: [
        "We take reasonable measures to secure your data, including secure database practices and access controls. However, no system is 100% secure, and you use Akiba at your own risk.",
      ],
    },
    {
      title: "7. Third-Party Services",
      paragraphs: [
        "Akiba uses third-party services to operate, including MiniPay as a distribution surface for the Mini-App, M-Pesa and banking services for merchant subscription payments, Supabase for data infrastructure, the Celo network for Miles records, and anti-spam providers. Akiba does not process customer purchase payments. Data handled by third-party services is subject to their own policies as applicable.",
      ],
    },
    {
      title: "8. Your Rights",
      paragraphs: [
        "You may request to view, update, or delete your data by contacting hello@akibamiles.com. Note that on-chain records (see Section 4) are outside our control and cannot be deleted; deletion requests apply to the data we hold in our own systems.",
      ],
    },
    {
      title: "9. Children's Privacy",
      paragraphs: [
        "Akiba is not intended for use by anyone under the age of 18. We do not knowingly collect data from children.",
      ],
    },
    {
      title: "10. Changes to This Policy",
      paragraphs: [
        "We may update this Privacy Policy. Continued use of Akiba after updates constitutes acceptance of the new policy.",
      ],
    },
    {
      title: "11. Contact",
      paragraphs: ["For questions or concerns, contact hello@akibamiles.com."],
    },
  ],
};

export const termsOfUse: LegalPage = {
  title: "Terms of Service",
  lastUpdated: "Sep 8, 2026",
  intro:
    "By accessing or using the Akiba applications or website, operated by Akiba Ecosystems Ltd (\"Akiba\", \"we\"), you agree to be bound by the following terms and conditions. If you do not agree, do not use the service.",
  sections: [
    {
      title: "1. What Akiba Is",
      paragraphs: [
        "Akiba is a loyalty network. Shoppers earn Miles on qualifying purchases at participating merchants via Scan & Award using their Akiba Pass, and can redeem Miles for merchant vouchers, discounts, and other rewards across the network.",
        "Akiba also includes the Akiba Hub and Pass, where users can collect Miles from purchases, spend Miles on merchant vouchers, and present those vouchers at participating merchants. The Akiba Mini-App on MiniPay lets users earn additional Miles through activities such as quests, challenges, and streaks, and use Miles for raffles and digital experiences.",
        "The Akiba Mini-App runs on MiniPay as a distribution surface. Akiba is built and operated by Akiba Ecosystems Ltd and is not affiliated with, or operated by, MiniPay or Opera.",
      ],
    },
    {
      title: "2. No Financial Advice or Guarantee",
      paragraphs: [
        "Akiba is not a financial service, and Miles do not represent any form of currency or financial instrument. Rewards offered through raffles are not guaranteed and may change without notice.",
      ],
    },
    {
      title: "3. Eligibility",
      paragraphs: [
        "You must be at least 18 years old to use Akiba. Use of Akiba is void where prohibited.",
      ],
    },
    {
      title: "4. Miles",
      paragraphs: [
        "Miles are loyalty points funded by merchants and campaigns. They can be redeemed for vouchers, discounts, and other rewards within the Akiba network, but they are not legal tender, cannot be redeemed for cash from Akiba, and have no guaranteed exchange value outside the network.",
        "Miles earned on purchases depend on the merchant's active campaign at the time of purchase. If a merchant has no active campaign or a campaign's reward budget is exhausted, a purchase may not earn Miles.",
        "Miles are recorded on a public blockchain ledger. Miles may be revoked at our discretion in cases of abuse, fraud, payment reversal, or misuse of the system.",
      ],
    },
    {
      title: "5. Purchases and Customer Payments",
      paragraphs: [
        "Customers always pay participating merchants directly. Akiba does not collect, process, hold, or settle customer purchase payments at any point.",
        "The Akiba Hub and Pass support the loyalty journey: customers collect Miles from qualifying purchases, spend Miles on vouchers, and use those vouchers with participating merchants.",
        "Rewards for purchases are issued when the merchant records or verifies the purchase through Akiba. Refunds, exchanges, payment disputes, and fulfilment remain between the customer and the merchant and are subject to the merchant's own policies.",
      ],
    },
    {
      title: "6. Vouchers",
      paragraphs: [
        "Vouchers are redeemed against purchases and may be limited to a specific merchant, product, or category. Vouchers may carry an expiry date, after which they are no longer usable. A voucher can be used once and cannot be transferred, resold, or exchanged for cash.",
        "We may cancel or claw back a voucher where it was obtained or used through fraud, abuse, or a purchase that was reversed or found to be invalid.",
      ],
    },
    {
      title: "7. Raffles and Rewards",
      paragraphs: [
        "Raffle entries using Miles are voluntary. Rewards are subject to availability and may include digital or physical items. We reserve the right to substitute or cancel any reward at any time.",
      ],
    },
    {
      title: "8. Merchants",
      paragraphs: [
        "Merchant participation in the Akiba network — including subscription plans and reward activity — is governed by a separate merchant agreement entered into during merchant onboarding. Subscription invoices are generated in the merchant dashboard and paid directly to Akiba by M-Pesa or bank transfer. These subscription payments are separate from customer purchases.",
        "Published subscription prices exclude VAT. Miles issued above a plan's monthly allowance are charged at the published per-Mile overage rate and added to the invoice for the next billing period. On quarterly and annual plans, overage is invoiced monthly.",
        "Monthly renewal invoices are issued 7 days before renewal. Quarterly and annual renewal invoices are issued 14 days before renewal. Akiba sends a reminder 3 days before the due date, on the due date, and 3 days after it, and may follow up directly with the merchant.",
        "An unpaid renewal invoice has a 7-day grace period. After the grace period, Akiba may pause new Miles issuance and voucher publishing until the invoice is paid in full. Vouchers already issued to customers remain redeemable, and full service is restored after payment is confirmed.",
        "A subscription cancellation takes effect at the end of the current paid term, and a term that has already started is not refundable. Plan upgrades take effect immediately and are prorated. Plan downgrades take effect at the next renewal.",
      ],
    },
    {
      title: "9. User Conduct",
      paragraphs: [
        "You agree not to abuse the platform, attempt to manipulate reward mechanisms or purchase verification, or create fraudulent accounts. Suspicious behavior may result in account suspension, voucher cancellation, or Miles revocation.",
      ],
    },
    {
      title: "10. Partner Inquiries",
      paragraphs: [
        "Submitting a merchant or partner inquiry does not create a partnership, campaign obligation, or commercial agreement. Any partnership or campaign is subject to separate review and approval.",
      ],
    },
    {
      title: "11. Privacy",
      paragraphs: [
        "Akiba respects your privacy. We collect data to operate the service, support rewards, and respond to relevant inquiries as described in our Privacy Policy.",
      ],
    },
    {
      title: "12. Changes to These Terms",
      paragraphs: [
        "We may update these Terms of Service at any time. Continued use of Akiba after updates constitutes your acceptance of the revised terms.",
      ],
    },
    {
      title: "13. Contact",
      paragraphs: [
        "If you have questions or concerns about these terms, contact hello@akibamiles.com.",
      ],
    },
  ],
};
