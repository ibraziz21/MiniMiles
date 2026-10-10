import { describe, expect, it } from "vitest";
import { getCacheStrategy, isCacheEligible, isSignedUrl } from "@/lib/sw-cache-policy";

describe("sw-cache-policy", () => {
  it("never caches /api/** responses", () => {
    expect(isCacheEligible("/api/admin/search?q=foo")).toBe(false);
    expect(getCacheStrategy("/api/admin/finance/subscriptions")).toBe("network-only");
  });

  it("never caches signed/evidence URLs regardless of path", () => {
    expect(isSignedUrl("/evidence/receipt.pdf?token=abc123")).toBe(true);
    expect(isSignedUrl("/evidence/receipt.pdf?Signature=abc123")).toBe(true);
    expect(isCacheEligible("/anything?expires=1234567890")).toBe(false);
  });

  it("never caches authenticated RSC data payload paths", () => {
    expect(isCacheEligible("/_next/data/build-id/overview.json")).toBe(false);
  });

  it("caches revisioned static assets and icons cache-first", () => {
    expect(getCacheStrategy("/_next/static/chunks/main-abc123.js")).toBe("cache-first");
    expect(getCacheStrategy("/icons/icon-512.png")).toBe("cache-first");
  });

  it("uses stale-while-revalidate only for the public login shell", () => {
    expect(getCacheStrategy("/login")).toBe("stale-while-revalidate");
    expect(getCacheStrategy("/svg/minimiles-symbol.svg")).toBe("stale-while-revalidate");
  });

  it("defaults authenticated navigations to network-only", () => {
    expect(getCacheStrategy("/overview")).toBe("network-only");
    expect(getCacheStrategy("/finance/subscriptions/123")).toBe("network-only");
  });
});
