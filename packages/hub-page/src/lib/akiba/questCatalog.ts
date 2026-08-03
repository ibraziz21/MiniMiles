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
  /**
   * Platform quest UUID this key maps to, from AKIBA_QUEST_ID_<KEY> env vars
   * (no shared quest-id source exists between react-app and hub-page — see
   * spec §4.3, Platform contract requirement).
   */
  platformQuestId: string | null;
  /** True only for the sponsored leaderboard — gated on a linked wallet. */
  requiresWallet: boolean;
};

function envQuestId(name: string): string | null {
  return process.env[`AKIBA_QUEST_ID_${name}`] || null;
}

export const HUB_QUEST_CATALOG: QuestCatalogEntry[] = [
  {
    key: "pass_activated",
    title: "Get your Akiba Pass",
    description: "Activate your Akiba Pass to start earning Miles.",
    miles: 20,
    frequency: "once",
    actionHref: "/pass",
    platformQuestId: envQuestId("PASS_ACTIVATED"),
    requiresWallet: false,
  },
  {
    key: "deal_viewed",
    title: "Browse this week's merchant deals",
    description: "Check out an active offer or voucher from our merchants.",
    miles: 5,
    frequency: "once",
    actionHref: "/vouchers?quest=deal_viewed",
    platformQuestId: envQuestId("DEAL_VIEWED"),
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
    platformQuestId: envQuestId("SPONSORED_GAME_PLAYED"),
    requiresWallet: true,
  },
  {
    key: "profile_country_set",
    title: "Tell us where you shop",
    description: "Set your country so we can show you relevant offers.",
    miles: 50,
    frequency: "once",
    actionHref: "/me",
    platformQuestId: envQuestId("PROFILE_COUNTRY_SET"),
    requiresWallet: false,
  },
  {
    key: "voucher_redeemed",
    title: "Use your first voucher",
    description: "Redeem a voucher with a merchant to earn Miles.",
    miles: 100,
    frequency: "once",
    actionHref: "/vouchers",
    platformQuestId: envQuestId("VOUCHER_REDEEMED"),
    requiresWallet: false,
  },
];

export function getQuestCatalogEntry(key: string): QuestCatalogEntry | undefined {
  return HUB_QUEST_CATALOG.find((q) => q.key === key);
}
