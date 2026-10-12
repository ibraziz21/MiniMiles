// Mirrors packages/website/src/content/legal.ts verbatim — one company, one
// set of policies. The text isn't forked or trimmed per surface: a Privacy
// Policy or Terms of Service that reads differently depending on which
// Akiba app you opened it from would be a real legal inconsistency, not a
// simplification. Keep the two files in sync when either changes.

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
  lastUpdated: "Oct 10, 2026",
  intro:
    "This Privacy Policy explains how Akiba Ecosystems Ltd (\"Akiba\", \"we\") collects, uses, and protects information when you use the Akiba services — including the Akiba Pass mobile app for iOS and Android, the Akiba Pass web experience, Scan & Award at participating merchants, the Akiba Hub, the Akiba Mini-App on MiniPay, and this website. By using our services or submitting information through this site, you agree to this policy.",
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
        "Interaction data from the Mini-App, Hub, and mobile app, such as point-earning actions, quest completions, referrals, raffle entries, and voucher redemptions.",
        "Your approximate location, only while you are using the app and only if you choose \"Near me\" to find nearby merchants. Coordinates are sent with that single search request and are not stored against your profile; the app never collects location in the background, and denying the permission leaves the rest of the app fully usable.",
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
        "You may request to view or update your data by contacting hello@akibamiles.com. To delete your whole account, you do not need to email us — see Section 9.",
        "Under the Kenya Data Protection Act you may ask us to erase personal data we are no longer authorised or required to keep. Some records are instead kept in a pseudonymised, access-restricted form where a legal, accounting, settlement, fraud-prevention, or audit purpose requires it; that is retention with restricted processing, not continued ordinary use of your data. On-chain records (see Section 4) are outside our control and cannot be deleted by anyone.",
      ],
    },
    {
      title: "9. Deleting Your Account",
      paragraphs: [
        "You can delete your entire Akiba account and the personal data connected to it. In the Akiba Pass app, open Settings, then the Danger zone section, then Delete account. Without the app, use https://app.akibamiles.com/account-deletion. Both paths use the same verification and the same process. We verify the request with a one-time code sent to your account email before accepting it, because otherwise anyone with your unlocked phone could delete your account.",
        "We delete your sign-in account and email address, your profile and contact details, your Akiba Pass and its credentials, your saved places, your notification and device registrations, our record of any wallet address you linked, and the photos and contributions you submitted.",
        "Deleting your account ends your access to Miles earned on it. Your Akiba Pass stops working and vouchers you have not yet redeemed become unusable. We cannot transfer Miles or vouchers to another account and cannot restore them afterwards. We will not refuse your deletion request because you still hold a balance or an active voucher.",
        "Some records survive deletion in pseudonymised form — with your name, email, and other direct identifiers removed — where an approved purpose requires it. That covers transaction and voucher-redemption records, merchant settlement and payment evidence, and fraud, security, and audit records. Access to those records is restricted, each is held only for its approved retention period, and we keep a record that you asked for deletion and that we carried it out.",
        "Transactions already written to the Celo blockchain, and the public wallet addresses in them, are permanent and public. Neither you nor Akiba can delete or change them. Deleting your Akiba account removes our own off-chain association with your wallet where our retention plan allows it; it does not and cannot remove anything from the blockchain itself.",
        "We aim to complete deletion within 14 calendar days of a verified request, unless we are legally required to hold data for longer, and we email your account address when processing finishes. You cannot cancel the request yourself once you confirm it. The version of this deletion notice shown when you confirm is 2026-10-10.1.",
        "If you have lost access to your account email and cannot receive the verification code, contact hello@akibamiles.com and we will verify you another way.",
      ],
    },
    {
      title: "10. Children's Privacy",
      paragraphs: [
        "Akiba is not intended for use by anyone under the age of 18. We do not knowingly collect data from children.",
      ],
    },
    {
      title: "11. Changes to This Policy",
      paragraphs: [
        "We may update this Privacy Policy. Continued use of Akiba after updates constitutes acceptance of the new policy.",
      ],
    },
    {
      title: "12. Contact",
      paragraphs: ["For questions or concerns, contact hello@akibamiles.com."],
    },
  ],
};

export const termsOfUse: LegalPage = {
  title: "Terms of Service",
  lastUpdated: "Oct 10, 2026",
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
        "Miles are tied to your Akiba account. If you delete your account, you lose access to the Miles earned on it; they cannot be transferred to another account, redeemed for cash, or restored.",
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
        "Vouchers are issued to your Akiba account. If you delete your account, your Akiba Pass stops working and any voucher you have not yet redeemed becomes unusable. Having an unredeemed voucher does not prevent you from deleting your account, and we cannot refund or transfer one.",
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
      title: "11. Privacy and Account Deletion",
      paragraphs: [
        "Akiba respects your privacy. We collect data to operate the service, support rewards, and respond to relevant inquiries as described in our Privacy Policy.",
        "You can delete your Akiba account at any time from Settings in the Akiba Pass app, or at https://app.akibamiles.com/account-deletion without the app. Section 9 of the Privacy Policy explains what is deleted, what is kept in pseudonymised form for legal and fraud-prevention purposes, what cannot be removed from the Celo blockchain, and how long processing takes.",
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
