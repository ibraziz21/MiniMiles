import type { MetadataRoute } from "next";
import { listPublicMerchants } from "@/lib/merchants/queries";

// Merchant slugs change with publish/pause/suspend state — always evaluate
// fresh rather than serving a stale sitemap.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hub.akibamiles.com";

// Sane upper bound so a runaway directory can't produce a pathological
// sitemap; raise (or paginate into sitemap indexes) once the network is
// larger than this.
const MAX_MERCHANT_URLS = 500;
const PAGE_SIZE = 50;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: new Date() },
    { url: `${SITE_URL}/merchants`, lastModified: new Date() },
  ];

  const merchantUrls: MetadataRoute.Sitemap = [];
  let cursor: string | undefined;

  try {
    while (merchantUrls.length < MAX_MERCHANT_URLS) {
      const { merchants, next_cursor } = await listPublicMerchants({
        mode: "all",
        limit: PAGE_SIZE,
        cursor,
      });
      for (const m of merchants) {
        merchantUrls.push({ url: `${SITE_URL}/merchants/${m.slug}`, lastModified: new Date() });
      }
      if (!next_cursor || merchants.length === 0) break;
      cursor = next_cursor;
    }
  } catch {
    // A directory outage shouldn't break the whole sitemap — fall back to
    // static routes only; merchant URLs will reappear once available.
  }

  return [...staticRoutes, ...merchantUrls.slice(0, MAX_MERCHANT_URLS)];
}
