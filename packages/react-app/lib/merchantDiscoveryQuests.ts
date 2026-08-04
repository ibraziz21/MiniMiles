// lib/merchantDiscoveryQuests.ts
// Quest IDs shared between components/merchant-discovery-quests.tsx and the
// partner-quests eligibility/claim API routes. Rows are seeded in
// sql/merchant_discovery_quests.sql — keep both in sync.

export const QUEST_AKIBA_PASS = "f647e695-7009-455a-a138-b3ee50de73f2";
export const QUEST_BROWSE_DEALS = "4eaf67c7-03f5-4c24-a63d-2c1c8ab765d1";
export const QUEST_SPONSORED_LEADERBOARD = "c94ded62-19e8-4d04-910b-56e0dd1bec34";
export const QUEST_COMPLETE_PROFILE = "47bc3625-f2f6-4b0f-ae72-b8bfde85bd31";
export const QUEST_REDEEM_VOUCHER = "2ad4bc13-d3b9-41b6-b3ef-d3a1ebb7b2aa";

export const MERCHANT_DISCOVERY_QUEST_IDS = [
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
  QUEST_SPONSORED_LEADERBOARD,
  QUEST_COMPLETE_PROFILE,
  QUEST_REDEEM_VOUCHER,
] as const;

export const CANONICAL_API_PARTNER_QUEST_IDS = new Set([
  "216cd2c5-74c9-4e79-80ba-612ecaff4aaf",
  "83f26878-c33a-4c40-b0d0-6f7bfdf33355",
  "7161b80b-ba30-404e-aba3-3faa24f763c7",
  "a2a2cce0-6607-4648-a7fc-698d0ee5a489",
  "2d3b9bb5-e3f2-49cf-8ca9-7369a2e03ff0",
]);

export type MerchantDiscoveryQuestId =
  (typeof MERCHANT_DISCOVERY_QUEST_IDS)[number];

export const MERCHANT_QUEST_PROOF_PASS_OPENED = "pass_onboarding_opened";
export const MERCHANT_QUEST_PROOF_DEAL_OPENED = "deal_opened";

export type MerchantQuestStatusState =
  | "needs_action"
  | "eligible"
  | "queued"
  | "completed"
  | "failed";

export type MerchantQuestStatus = {
  questId: MerchantDiscoveryQuestId;
  state: MerchantQuestStatusState;
  reason?: string;
};
