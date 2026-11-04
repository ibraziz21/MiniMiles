export const AKIBA_HUB_APP_URL = "https://app.akibamiles.com";
export const PARTNER_WITH_AKIBA_URL = "https://partners.akibamiles.com";
export const AKIBA_X_URL = "https://x.com/akibamiles";
export const AKIBA_TELEGRAM_URL = "https://t.me/akibamiles";
export const AKIBA_EMAIL = "hello.akibamiles@gmail.com";
export const PRIVACY_POLICY_URL = "/privacy-policy";
export const TERMS_URL = "/terms-of-use";

export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.akibamiles.akiba";

export function playStoreUrl(slot: string): string {
  const referrer = new URLSearchParams({ utm_source: "hub", utm_medium: "web", utm_campaign: slot });
  return `${PLAY_STORE_URL}&referrer=${encodeURIComponent(referrer.toString())}`;
}
