// Launch catalog for the account-first Hub quest experience
// (merchant-shopping-quests-spec.md §3). Ported from react-app's
// merchantDiscoveryQuests.ts catalog intent, not its wallet-first identity
// model — Hub-side status/claim resolve against email + linked wallets
// (see questStatus.ts), never a single "reward wallet".

export type QuestFrequency = "once" | "weekly";

export type QuestCatalogEntry = {
  key: string;
  title: string;
  description: string;
  miles: number;
  frequency: QuestFrequency;
  /** In-Hub route the CTA sends the member to. */
  actionHref: string;
  /** Canonical API catalog UUID from quest_catalog_bindings. */
  apiPartnerQuestId: string;
  /** React compatibility catalog UUID from quest_catalog_bindings. */
  reactPartnerQuestId: string;
  /** True only for the sponsored leaderboard — gated on a linked wallet. */
  requiresWallet: boolean;
};

export const HUB_QUEST_CATALOG: QuestCatalogEntry[] = [
  {
    key: "pass_activated",
    title: "Get your Akiba Pass",
    description: "Activate your Akiba Pass to start earning Miles.",
    miles: 20,
    frequency: "once",
    actionHref: "/pass",
    apiPartnerQuestId: "216cd2c5-74c9-4e79-80ba-612ecaff4aaf",
    reactPartnerQuestId: "f647e695-7009-455a-a138-b3ee50de73f2",
    requiresWallet: false,
  },
  {
    key: "deal_viewed",
    title: "Browse this week's merchant deals",
    description: "Check out an active offer or voucher from our merchants.",
    miles: 5,
    frequency: "once",
    actionHref: "/vouchers?quest=deal_viewed",
    apiPartnerQuestId: "83f26878-c33a-4c40-b0d0-6f7bfdf33355",
    reactPartnerQuestId: "4eaf67c7-03f5-4c24-a63d-2c1c8ab765d1",
    requiresWallet: false,
  },
  {
    key: "sponsored_game_played",
    title: "Play the sponsored leaderboard",
    description: "Play this week's sponsored challenge for bonus Miles.",
    miles: 25,
    frequency: "weekly",
    actionHref: process.env.NEXT_PUBLIC_REACT_APP_URL
      ? `${process.env.NEXT_PUBLIC_REACT_APP_URL}/earn`
      : "/earn",
    apiPartnerQuestId: "7161b80b-ba30-404e-aba3-3faa24f763c7",
    reactPartnerQuestId: "c94ded62-19e8-4d04-910b-56e0dd1bec34",
    requiresWallet: true,
  },
  {
    key: "profile_country_set",
    title: "Tell us where you shop",
    description: "Set your country so we can show you relevant offers.",
    miles: 50,
    frequency: "once",
    actionHref: "/me",
    apiPartnerQuestId: "a2a2cce0-6607-4648-a7fc-698d0ee5a489",
    reactPartnerQuestId: "47bc3625-f2f6-4b0f-ae72-b8bfde85bd31",
    requiresWallet: false,
  },
  {
    key: "voucher_redeemed",
    title: "Use your first voucher",
    description: "Redeem a voucher with a merchant to earn Miles.",
    miles: 100,
    frequency: "once",
    actionHref: "/vouchers",
    apiPartnerQuestId: "2d3b9bb5-e3f2-49cf-8ca9-7369a2e03ff0",
    reactPartnerQuestId: "2ad4bc13-d3b9-41b6-b3ef-d3a1ebb7b2aa",
    requiresWallet: false,
  },
];

export function getQuestCatalogEntry(key: string): QuestCatalogEntry | undefined {
  return HUB_QUEST_CATALOG.find((q) => q.key === key);
}
