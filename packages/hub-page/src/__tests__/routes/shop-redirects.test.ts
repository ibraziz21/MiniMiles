import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config.mjs";

describe("/shop -> /merchants permanent redirects", () => {
  it("redirects /shop to /merchants and preserves any query string", async () => {
    const redirects = await nextConfig.redirects!();
    const shopRedirect = redirects.find((r) => r.source === "/shop");

    expect(shopRedirect).toMatchObject({ destination: "/merchants", permanent: true });
    // Next.js forwards the original query string on a redirect whose
    // destination doesn't declare its own query params — nothing here
    // strips or hardcodes one away.
    expect(shopRedirect?.destination).not.toContain("?");
  });

  it("redirects /shop/:slug to /merchants/:slug, forwarding the slug param and any query string", async () => {
    const redirects = await nextConfig.redirects!();
    const slugRedirect = redirects.find((r) => r.source === "/shop/:slug");

    expect(slugRedirect).toMatchObject({ destination: "/merchants/:slug", permanent: true });
  });
});
