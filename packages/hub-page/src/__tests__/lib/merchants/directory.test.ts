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
    expect(canonicalProfileUrl("arabica-coffee-house", HUB, {})).toBe(
      `${HUB}/merchants/arabica-coffee-house`
    );
  });

  it("does not double up a slash when the hub URL has a trailing one", () => {
    expect(canonicalProfileUrl("x", `${HUB}/`, {})).toBe(`${HUB}/merchants/x`);
  });
});

describe("canonical URLs after relocation", () => {
  const env = { NEXT_PUBLIC_DIRECTORY_ORIGIN: WWW };

  it("moves the listing to the marketing site's /shops", () => {
    expect(canonicalDirectoryUrl(HUB, env)).toBe(`${WWW}/shops`);
  });

  it("moves each profile to the marketing site's /shops/[slug]", () => {
    expect(canonicalProfileUrl("arabica-coffee-house", HUB, env)).toBe(
      `${WWW}/shops/arabica-coffee-house`
    );
  });

  it("reports the directory as relocated", () => {
    expect(isDirectoryRelocated(env)).toBe(true);
  });

  it("ignores the hub URL entirely once relocated", () => {
    expect(canonicalProfileUrl("x", "https://something-else.example", env)).toBe(`${WWW}/shops/x`);
  });
});
