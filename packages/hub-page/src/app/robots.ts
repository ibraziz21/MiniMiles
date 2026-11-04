import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pass.akibamiles.com";

/**
 * Without this route the hub serves no /robots.txt at all, so nothing ever
 * points crawlers at the merchant sitemap.
 *
 * The disallow list is a crawl-budget measure, not a security boundary —
 * signed-in areas are enforced by middleware and by the routes themselves.
 * It keeps crawlers off pages that redirect to /login (and so waste a fetch
 * to reach nothing) and off non-document routes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/r/", // short-link redirector, not a document
          "/login",
          "/join",
          "/me",
          "/pass",
          "/welcome",
          "/referrals",
          "/games",
          "/earn",
          "/visit",
          "/my-vouchers",
          "/profile-visual-check",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
