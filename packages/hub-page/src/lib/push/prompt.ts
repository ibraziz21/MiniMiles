export const PUSH_PROMPT_DISMISS_KEY = "akiba:push:prompt_dismissed_v1";
export const PUSH_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export type PushPromptEligibility = {
  signedIn: boolean;
  supported: boolean;
  standalone: boolean;
  permission: NotificationPermission;
  hasSubscription: boolean;
  marketingEnabled: boolean;
  hasVapidKey: boolean;
  recentlyDismissed: boolean;
};

export function shouldOfferPushPrompt(input: PushPromptEligibility): boolean {
  return (
    input.signedIn &&
    input.supported &&
    input.standalone &&
    input.permission !== "denied" &&
    (!input.hasSubscription || !input.marketingEnabled) &&
    input.hasVapidKey &&
    !input.recentlyDismissed
  );
}

export function wasPushPromptRecentlyDismissed(
  storedValue: string | null,
  now = Date.now(),
): boolean {
  if (!storedValue) return false;
  const dismissedAt = Number(storedValue);
  return Number.isFinite(dismissedAt) && now - dismissedAt < PUSH_PROMPT_SNOOZE_MS;
}
