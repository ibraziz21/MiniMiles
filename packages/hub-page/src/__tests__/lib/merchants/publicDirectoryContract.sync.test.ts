/**
 * The marketing site renders www/shops from the public directory API, and
 * declares the wire shape by hand in its own file because it can't depend on
 * this Next app. Hand-mirrored types drift silently: a field added here and
 * forgotten there shows up as `undefined` in rendered HTML, which no unit
 * test on either side would catch.
 *
 * That package has no test runner of its own, so the check lives here. It
 * compares field names declared for each shared type in the two files — a
 * static, dependency-free read, not a mock.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HUB_CONTRACT = join(process.cwd(), "src/lib/merchants/publicDirectoryContract.ts");
const WEBSITE_CONTRACT = join(process.cwd(), "../website/src/lib/directory/types.ts");

/** Types declared in both files whose fields must match exactly. */
const SHARED_TYPES = [
  "DirectoryCategory",
  "DirectoryMerchantSummary",
  "DirectoryLocation",
  "DirectoryMedia",
  "DirectoryOffer",
  "DirectoryVoucher",
  "DirectoryVerifiedVisit",
  "DirectoryMerchantProfile",
];

/**
 * Body of `export type <name> = ... { ... }`, found by matching braces from
 * the first `{` after the declaration so nested object literals are included.
 */
function typeBody(source: string, typeName: string): string {
  const declaration = new RegExp(`export type ${typeName}\\b[^=]*=`, "m").exec(source);
  if (!declaration) throw new Error(`type ${typeName} not declared`);

  const start = source.indexOf("{", declaration.index + declaration[0].length);
  if (start === -1) throw new Error(`type ${typeName} has no object body`);

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  throw new Error(`type ${typeName} has an unbalanced body`);
}

/** Field names declared in a type body, at any nesting depth, comments stripped. */
function fieldNames(body: string): string[] {
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const names = new Set<string>();
  for (const match of withoutComments.matchAll(/(^|[\s{;,])"?([A-Za-z_][\w]*)"?\s*\??\s*:/g)) {
    names.add(match[2]);
  }
  return [...names].sort();
}

describe("public directory contract stays in sync with the marketing site", () => {
  const hub = readFileSync(HUB_CONTRACT, "utf8");
  const website = readFileSync(WEBSITE_CONTRACT, "utf8");

  it.each(SHARED_TYPES)("%s declares the same fields on both sides", (typeName) => {
    expect(fieldNames(typeBody(website, typeName))).toEqual(
      fieldNames(typeBody(hub, typeName))
    );
  });

  it("names this file as the source of truth from the marketing site", () => {
    // The comment is how the next person knows which side to change first.
    expect(website).toContain("publicDirectoryContract.ts");
  });

  it("keeps customer visit photos out of the contract on both sides", () => {
    // These are the only signed, expiring URLs in the projection; letting one
    // in would make the API uncacheable and bake expiring URLs into CDN HTML.
    for (const source of [hub, website]) {
      expect(source).not.toContain("approvedCustomerPhotos");
      expect(source).not.toContain("displayUrl");
    }
  });

  it("recognises a field added on only one side", () => {
    // Guards the detector itself: a comparison that silently passes on
    // anything would make this whole file decorative.
    const withExtra = website.replace(
      "export type DirectoryVerifiedVisit = {",
      "export type DirectoryVerifiedVisit = {\n  ratingValue: number;"
    );
    expect(fieldNames(typeBody(withExtra, "DirectoryVerifiedVisit"))).not.toEqual(
      fieldNames(typeBody(hub, "DirectoryVerifiedVisit"))
    );
  });
});
