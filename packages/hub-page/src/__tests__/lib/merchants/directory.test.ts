/**
 * The directory origin decides what every merchant profile declares as its
 * canonical URL, so a wrong value here is a site-wide SEO fault that nothing
 * else would catch — and an unset value must leave today's behaviour exactly
 * as it is.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalDirectoryUrl,
  canonicalProfileUrl,
  directoryOrigin,
  hubProfileUrl,
  isDirectoryRelocated,
} from "@/lib/merchants/directory";

const HUB = "https://pass.akibamiles.com";
const WWW = "https://www.akibamiles.com";

describe("directoryOrigin", () => {
  it("is null when unset, so canonicals stay on the hub", () => {
    expect(directoryOrigin({})).toBeNull();
    expect(isDirectoryRelocated({})).toBe(false);
  });

  it("is null for a blank or whitespace value", () => {
    expect(directoryOrigin({ NEXT_PUBLIC_DIRECTORY_ORIGIN: "" })).toBeNull();
    expect(directoryOrigin({ NEXT_PUBLIC_DIRECTORY_ORIGIN: "   " })).toBeNull();
  });

  it("reduces a configured value to its origin and drops any trailing slash", () => {
    expect(directoryOrigin({ NEXT_PUBLIC_DIRECTORY_ORIGIN: `${WWW}/` })).toBe(WWW);
    expect(directoryOrigin({ NEXT_PUBLIC_DIRECTORY_ORIGIN: `${WWW}/shops` })).toBe(WWW);
  });

  it("falls back to null rather than throwing on a malformed value", () => {
    // env.server.ts is where a bad URL becomes a boot failure; a page render
    // must degrade to the hub canonical instead of a 500.
    expect(directoryOrigin({ NEXT_PUBLIC_DIRECTORY_ORIGIN: "not a url" })).toBeNull();
    expect(directoryOrigin({ NEXT_PUBLIC_DIRECTORY_ORIGIN: "javascript:alert(1)" })).toBeNull();
  });
});

describe("canonical URLs before relocation", () => {
  it("names the hub's own directory listing", () => {
    expect(canonicalDirectoryUrl(HUB, {})).toBe(`${HUB}/merchants`);
  });

  it("names the hub's own profile URL", () => {
    expect(canonicalProfileUrl("arabica-coffee-house", HUB, true, {})).toBe(
      `${HUB}/merchants/arabica-coffee-house`
    );
  });

  it("does not double up a slash when the hub URL has a trailing one", () => {
    expect(canonicalProfileUrl("x", `${HUB}/`, true, {})).toBe(`${HUB}/merchants/x`);
  });
});

describe("canonical URLs after relocation", () => {
  const env = { NEXT_PUBLIC_DIRECTORY_ORIGIN: WWW };

  it("moves the listing to the marketing site's /shops", () => {
    expect(canonicalDirectoryUrl(HUB, env)).toBe(`${WWW}/shops`);
  });

  it("moves each profile to the marketing site's /shops/[slug]", () => {
    expect(canonicalProfileUrl("arabica-coffee-house", HUB, true, env)).toBe(
      `${WWW}/shops/arabica-coffee-house`
    );
  });

  it("reports the directory as relocated", () => {
    expect(isDirectoryRelocated(env)).toBe(true);
  });

  it("ignores the hub URL entirely once relocated", () => {
    expect(canonicalProfileUrl("x", "https://something-else.example", true, env)).toBe(`${WWW}/shops/x`);
  });
});

describe("a profile the marketing site does not publish", () => {
  const env = { NEXT_PUBLIC_DIRECTORY_ORIGIN: WWW };

  /**
   * Regression: this reached production. The only published merchant had a
   * 24-character description, so it failed the indexability gate — which
   * noindexes it here and makes the directory API 404 it — while its
   * canonical still named www/shops/<slug>. The result was a live profile
   * pointing its canonical at a 404.
   */
  it("stays self-canonical on the hub even once the directory is relocated", () => {
    expect(canonicalProfileUrl("arabica-1976-information", HUB, false, env)).toBe(
      `${HUB}/merchants/arabica-1976-information`
    );
  });

  it("is unaffected before relocation", () => {
    expect(canonicalProfileUrl("stub", HUB, false, {})).toBe(`${HUB}/merchants/stub`);
  });

  it("never names the marketing site for a stub, whatever the origin", () => {
    const url = canonicalProfileUrl("stub", HUB, false, env);
    expect(url).not.toContain(WWW);
    expect(url).not.toContain("/shops");
  });
});

describe("hubProfileUrl", () => {
  it("always names this host, since it serves the profile either way", () => {
    expect(hubProfileUrl("acme", HUB)).toBe(`${HUB}/merchants/acme`);
    expect(hubProfileUrl("acme", `${HUB}/`)).toBe(`${HUB}/merchants/acme`);
  });
});
