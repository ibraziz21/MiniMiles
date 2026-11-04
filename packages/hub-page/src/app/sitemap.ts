import type { MetadataRoute } from "next";
import { listPublicMerchants } from "@/lib/merchants/queries";
import { isProfileIndexable } from "@/lib/merchants/seo";
import { isDirectoryRelocated } from "@/lib/merchants/directory";

// Merchant slugs change with publish/pause/suspend state — always evaluate
// fresh rather than serving a stale sitemap.
export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pass.akibamiles.com";

// Sane upper bound so a runaway directory can't produce a pathological
// sitemap; raise (or paginate into sitemap indexes) once the network is
// larger than this.
const MAX_MERCHANT_URLS = 500;
const PAGE_SIZE = 50;
// Filtering happens after the fetch, so a directory of mostly incomplete
// profiles would otherwise keep paging long past MAX_MERCHANT_URLS. Bound
// the scan as well as the output.
const MAX_PAGES = Math.ceil((MAX_MERCHANT_URLS / PAGE_SIZE) * 4);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: new Date() },
  ];

  // A sitemap should only ever list canonical URLs. Once the directory's
  // canonical home is the marketing site, these pages keep being served here
  // for native deep links but belong in that site's sitemap, not this one —
  // listing them here earns a "not selected as canonical" warning instead of
  // an index entry.
  if (isDirectoryRelocated()) {
    return staticRoutes;
  }

  staticRoutes.push({ url: `${SITE_URL}/merchants`, lastModified: new Date() });

  const merchantUrls: MetadataRoute.Sitemap = [];
  let cursor: string | undefined;
  let pagesScanned = 0;

  try {
    while (merchantUrls.length < MAX_MERCHANT_URLS && pagesScanned < MAX_PAGES) {
      pagesScanned += 1;
      const { merchants, next_cursor } = await listPublicMerchants({
        mode: "all",
        limit: PAGE_SIZE,
        cursor,
      });
      for (const m of merchants) {
        // The profile page serves `noindex` for the same merchants, and a
        // sitemap URL that then refuses indexing is a Search Console error —
        // so both sides apply `isProfileIndexable` and stay in agreement.
        if (!isProfileIndexable(m)) continue;
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
