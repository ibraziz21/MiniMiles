import { APP_STORE_URL, PLAY_STORE_URL } from "@/content/site";

export type DownloadPlatform = "ios" | "android" | "unknown";

const CAMPAIGN_KEYS = ["source", "ref", "utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

export function downloadCampaign(params: URLSearchParams): URLSearchParams {
  const campaign = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) {
    const value = params.get(key);
    // Campaign identifiers are public slugs, never arbitrary URLs or personal data.
    if (value && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) campaign.set(key, value);
  }
  return campaign;
}

export function downloadPlatform(userAgent: string): DownloadPlatform {
  if (/bot|crawler|spider|preview|facebookexternalhit/i.test(userAgent)) return "unknown";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/android/i.test(userAgent)) return "android";
  // iPads using a desktop user agent intentionally get the store chooser.
  return "unknown";
}

export function downloadStoreUrl(platform: "ios" | "android", campaign: URLSearchParams): string {
  const url = new URL(platform === "ios" ? APP_STORE_URL : PLAY_STORE_URL);
  if (platform === "android") {
    const referrer = new URLSearchParams({
      utm_source: campaign.get("utm_source") ?? campaign.get("source") ?? "website",
      utm_medium: campaign.get("utm_medium") ?? "download",
      utm_campaign: campaign.get("utm_campaign") ?? "akiba",
    });
    const content = campaign.get("utm_content") ?? campaign.get("ref");
    if (content) referrer.set("utm_content", content);
    url.searchParams.set("referrer", referrer.toString());
  }
  return url.toString();
}
