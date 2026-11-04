import type { MetadataRoute } from "next";
import { siteConfig } from "@/content/site";
import { DirectoryUnavailable, listDirectoryMerchants } from "@/lib/directory/client";

// Shop URLs come from live directory state, so this can't be computed at
// build time.
export const dynamic = "force-dynamic";

// Upper bound so a growing directory can't produce a pathological sitemap;
// split into a sitemap index once the network outgrows it.
const MAX_SHOP_URLS = 1000;
const PAGE_SIZE = 50;
// The API already filters to indexable profiles, but bound the scan anyway so
// an unexpected response can't page forever.
const MAX_PAGES = Math.ceil((MAX_SHOP_URLS / PAGE_SIZE) * 2);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/shops",
    "/for-business",
    "/about",
    "/support",
    "/developers",
    "/privacy-policy",
    "/terms-of-use",
  ].map((route) => ({ url: `${siteConfig.siteUrl}${route}`, lastModified: now }));

  const shopUrls: MetadataRoute.Sitemap = [];
  let cursor: string | undefined;
  let pagesScanned = 0;

  try {
    while (shopUrls.length < MAX_SHOP_URLS && pagesScanned < MAX_PAGES) {
      pagesScanned += 1;
      const { merchants, nextCursor } = await listDirectoryMerchants({
        limit: PAGE_SIZE,
        cursor,
      });
      for (const merchant of merchants) {
        shopUrls.push({ url: `${siteConfig.siteUrl}/shops/${merchant.slug}`, lastModified: now });
      }
      if (!nextCursor || merchants.length === 0) break;
      cursor = nextCursor;
    }
  } catch (error) {
    // A directory outage shouldn't empty the whole sitemap — fall back to the
    // static routes and let the shop URLs reappear once it recovers.
    if (!(error instanceof DirectoryUnavailable)) throw error;
  }

  return [...staticRoutes, ...shopUrls.slice(0, MAX_SHOP_URLS)];
}
