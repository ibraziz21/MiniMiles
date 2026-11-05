import { getPublishedMerchantBanners } from "@/lib/merchants/queries";
import type { HomeFeedResponse } from "./types";

export async function addHomePlaceBanners(feed: HomeFeedResponse, requestUrl?: string): Promise<HomeFeedResponse> {
  const placeIds = [...new Set(feed.sections.flatMap((section) =>
    section.merchants.filter((place) => !place.bannerUrl).map((place) => place.id),
  ))];
  const banners = await getPublishedMerchantBanners(placeIds).catch(() => ({} as Record<string, string>));
  const sections = feed.sections.map((section) => ({
    ...section,
    merchants: section.merchants.map((place) => {
      const banner = place.bannerUrl ?? banners[place.id] ?? null;
      return {
        ...place,
        bannerUrl: requestUrl && banner?.startsWith("/") && !banner.startsWith("//")
          ? new URL(banner, requestUrl).href
          : banner,
      };
    }),
  }));
  return { ...feed, sections };
}
