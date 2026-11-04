export const APP_INSTALL_DISMISS_KEY = "akiba:app:install_dismissed_v1";
export const APP_INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function shouldOfferAppInstall(input: {
  android: boolean; standalone: boolean; recentlyDismissed: boolean; pathname: string;
}): boolean {
  return input.android && !input.standalone && !input.recentlyDismissed && input.pathname !== "/welcome";
}

export function wasRecentlyDismissed(storedValue: string | null, now = Date.now()): boolean {
  if (!storedValue?.trim()) return false;
  const dismissedAt = Number(storedValue);
  return Number.isFinite(dismissedAt) && dismissedAt > 0 && dismissedAt <= now && now - dismissedAt < APP_INSTALL_SNOOZE_MS;
}
