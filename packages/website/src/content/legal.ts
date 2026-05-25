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
  lastUpdated: "Jul 2, 2025",
  intro:
    "This Privacy Policy explains how AkibaMiles collects, uses, and protects information when you use the AkibaMiles service or contact us about partnership opportunities. By using the app or submitting information through this site, you agree to this policy.",
  sections: [
    {
      title: "1. What We Collect",
      paragraphs: [
        "We collect only the data necessary to operate AkibaMiles and respond to relevant inquiries.",
      ],
      bullets: [
        "Wallet address, to assign points and track activity.",
        "Basic interaction data, such as point-earning actions, referrals, raffle entries, and challenge completion.",
        "Optional profile and social information if you provide it for quests, physical rewards, winner contact, or profile completion.",
        "Business contact details when you submit a partner inquiry, such as name, email, company, country, website, role, and message.",
      ],
    },
    {
      title: "2. How We Use Your Data",
      bullets: [
        "Assign and track AkibaMiles points.",
        "Display progress on dashboards, leaderboards, badges, and profiles.",
        "Enable raffle entries, reward distribution, and winner contact.",
        "Review partner inquiries and respond to business requests.",
        "Improve app performance, safety, and user experience.",
      ],
    },
    {
      title: "3. Cookies and Analytics",
      paragraphs: [
        "AkibaMiles may use basic analytics or anti-abuse tooling to improve functionality and protect forms. Analytics, if enabled, should be limited to product improvement and operational safety.",
      ],
    },
    {
      title: "4. Data Security",
      paragraphs: [
        "We take reasonable measures to secure your data, including secure database practices and access controls. However, no system is 100% secure, and you use AkibaMiles at your own risk.",
      ],
    },
    {
      title: "5. Third-Party Services",
      paragraphs: [
        "AkibaMiles may integrate with third-party services such as MiniPay, social platforms, Supabase, and anti-spam providers. Data handled by those services is subject to their policies as applicable.",
      ],
    },
    {
      title: "6. Your Rights",
      paragraphs: [
        "You may request to view, update, or delete your data by contacting hello@akibamiles.com.",
      ],
    },
    {
      title: "7. Children's Privacy",
      paragraphs: [
        "AkibaMiles is not intended for use by anyone under the age of 13. We do not knowingly collect data from children.",
      ],
    },
    {
      title: "8. Changes to This Policy",
      paragraphs: [
        "We may update this Privacy Policy. Continued use of AkibaMiles after updates constitutes acceptance of the new policy.",
      ],
    },
    {
      title: "9. Contact",
      paragraphs: ["For questions or concerns, contact hello@akibamiles.com."],
    },
  ],
};

export const termsOfUse: LegalPage = {
  title: "Terms of Service",
  lastUpdated: "Jul 2, 2025",
  intro:
    "By accessing or using the AkibaMiles application or website, you agree to be bound by the following terms and conditions. If you do not agree, do not use the service.",
  sections: [
    {
      title: "1. What AkibaMiles Is",
      paragraphs: [
        "AkibaMiles is a gamified loyalty system that allows users of the MiniPay wallet to earn non-transferable points through predefined activities. These points may be used to enter raffles, access rewards, and participate in digital experiences.",
      ],
    },
    {
      title: "2. No Financial Advice or Guarantee",
      paragraphs: [
        "AkibaMiles is not a financial service, and AkibaMiles do not represent any form of currency or financial instrument. Rewards offered through raffles are not guaranteed and may change without notice.",
      ],
    },
    {
      title: "3. Eligibility",
      paragraphs: [
        "You must be of legal age in your jurisdiction to participate. Use of AkibaMiles is void where prohibited.",
      ],
    },
    {
      title: "4. Point System",
      paragraphs: [
        "AkibaMiles are non-transferable, non-exchangeable, and hold no real-world monetary value. Points may be earned or revoked at our discretion in cases of abuse, fraud, or misuse of the system.",
      ],
    },
    {
      title: "5. Raffles and Rewards",
      paragraphs: [
        "Raffle entries using AkibaMiles are voluntary and risk-free. Rewards are subject to availability and may include digital or physical items. We reserve the right to substitute or cancel any reward at any time.",
      ],
    },
    {
      title: "6. User Conduct",
      paragraphs: [
        "You agree not to abuse the platform, attempt to manipulate point-earning mechanisms, or create fraudulent accounts. Suspicious behavior may result in account suspension or point revocation.",
      ],
    },
    {
      title: "7. Partner Inquiries",
      paragraphs: [
        "Submitting a partner inquiry does not create a partnership, campaign obligation, or commercial agreement. Any partner campaign is subject to separate review and approval.",
      ],
    },
    {
      title: "8. Privacy",
      paragraphs: [
        "AkibaMiles respects your privacy. We collect data to operate the service, support rewards, and respond to relevant inquiries as described in our Privacy Policy.",
      ],
    },
    {
      title: "9. Changes to These Terms",
      paragraphs: [
        "We may update these Terms of Service at any time. Continued use of AkibaMiles after updates constitutes your acceptance of the revised terms.",
      ],
    },
    {
      title: "10. Contact",
      paragraphs: [
        "If you have questions or concerns about these terms, contact hello@akibamiles.com.",
      ],
    },
  ],
};
