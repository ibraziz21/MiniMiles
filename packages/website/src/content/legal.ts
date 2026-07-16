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
  lastUpdated: "Jul 16, 2026",
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
        "Order and payment data when you buy through the Akiba Hub, including M-Pesa transaction references processed via Safaricom's payment systems.",
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
        "Process orders, payments, voucher issuance, and voucher redemptions.",
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
        "Akiba integrates with third-party services to operate: MiniPay (distribution surface for the Mini-App), Safaricom M-Pesa (payment processing), Supabase (data infrastructure), the Celo blockchain network, and anti-spam providers. Data handled by those services is subject to their own policies as applicable.",
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
  lastUpdated: "Jul 16, 2026",
  intro:
    "By accessing or using the Akiba applications or website, operated by Akiba Ecosystems Ltd (\"Akiba\", \"we\"), you agree to be bound by the following terms and conditions. If you do not agree, do not use the service.",
  sections: [
    {
      title: "1. What Akiba Is",
      paragraphs: [
        "Akiba is a loyalty network. Shoppers earn Miles on qualifying purchases at participating merchants via Scan & Award using their Akiba Pass, and can redeem Miles for merchant vouchers, discounts, and other rewards across the network.",
        "Akiba also includes the Akiba Hub — where users can shop from participating merchants, manage their Pass, and redeem vouchers — and the Akiba Mini-App on the MiniPay wallet, where users can earn additional Miles through predefined activities such as quests, challenges, and streaks, and use Miles for raffles and digital experiences.",
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
      title: "5. Purchases and Payments",
      paragraphs: [
        "Purchases made through the Akiba Hub are paid via M-Pesa or other supported payment methods. An order is complete only when payment is confirmed. If a payment fails or is cancelled, any voucher applied to that order is released back to you and no Miles are awarded.",
        "Rewards for in-store purchases are issued when the merchant scans your Akiba Pass and the purchase is verified. Refunds and exchanges for goods purchased from a merchant are subject to that merchant's own policies.",
      ],
    },
    {
      title: "6. Vouchers",
      paragraphs: [
        "Vouchers are redeemed against purchases and may be limited to a specific merchant, product, or category. Vouchers may carry an expiry date, after which they are no longer usable. A voucher can be used once and cannot be transferred, resold, or exchanged for cash.",
        "We may cancel or claw back a voucher where it was obtained or used through fraud, abuse, or a reversed payment.",
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
        "Merchant participation in the Akiba network — including subscription plans, service fees, reward funding, and payouts — is governed by a separate merchant agreement entered into during merchant onboarding. Published pricing on this website is indicative and may change.",
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
