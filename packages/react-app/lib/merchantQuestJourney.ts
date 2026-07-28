const STARTED_STORAGE_PREFIX = "akiba:merchant-quest:started:";

const ACTION_REQUIRED_MESSAGES: Record<string, string> = {
  "country-not-set":
    "Add your country in Profile, then return here and verify again.",
  "no-redeemed-voucher":
    "Redeem a voucher at checkout, then return here and verify again.",
  "pass-onboarding-not-opened":
    "Open the Akiba Pass onboarding, then return here and verify again.",
  "deal-not-opened":
    "Open one of this week's deal cards in Spend, then return here and verify again.",
  "no-accepted-session-this-week":
    "Finish a scored Weekly Challenge game this week, then return here and verify again.",
  "no-sponsored-session-this-week":
    "Finish an accepted session in this week's sponsored game, then return here and verify again.",
  "no-active-sponsored-campaign":
    "There is no sponsored Weekly Challenge running right now. Please try again when the next campaign starts.",
  "no-stable-balance":
    "Your wallet must hold some cUSD, USDT, or USDC before you can claim this reward.",
  "stable-too-new":
    "Your stablecoin balance must be at least one day old before you can claim this reward.",
};

const FRIENDLY_MESSAGES: Record<string, string> = {
  ...ACTION_REQUIRED_MESSAGES,
  "already-claimed": "You have already completed this quest.",
  "already-claimed-this-week":
    "You have already completed this quest for the current week.",
  "Authentication required":
    "Reconnect your wallet, then try verifying the quest again.",
  "Quest not found":
    "This quest is temporarily unavailable. Please try again later.",
};

export function buildMerchantQuestActionHref(
  actionLink: string,
  questId: string,
): string {
  const url = new URL(actionLink, "https://app.akibamiles.local");
  url.searchParams.set("merchantQuest", questId);
  url.searchParams.set("returnTo", `/earn?quest=${questId}`);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function markMerchantQuestStarted(questId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(`${STARTED_STORAGE_PREFIX}${questId}`, "1");
}

export function hasMerchantQuestStarted(questId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(`${STARTED_STORAGE_PREFIX}${questId}`) === "1";
}

export function readStartedMerchantQuestIds(questIds: string[]): string[] {
  return questIds.filter(hasMerchantQuestStarted);
}

export function friendlyMerchantQuestError(
  error: string | undefined,
  reason?: string,
): string {
  const key = reason || error || "";
  if (FRIENDLY_MESSAGES[key]) return FRIENDLY_MESSAGES[key];
  if (error && !/^[a-z0-9-]+$/.test(error)) return error;
  return "We could not verify this quest yet. Finish the action and try again.";
}

export function isMerchantQuestActionRequired(
  error: string | undefined,
  reason?: string,
): boolean {
  const key = reason || error || "";
  return key in ACTION_REQUIRED_MESSAGES;
}

export function safeMerchantQuestReturnTo(value: string | null): string | null {
  if (!value) return null;
  return value === "/earn" || value.startsWith("/earn?") ? value : null;
}
