import { existsSync, readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { privacyPolicy, termsOfUse } from "@/content/legal";
import { DELETION_POLICY_VERSION } from "@/lib/akiba/accountDeletionPolicy";
import { getLegalLinks } from "@/lib/mobile/appConfig.server";

function sectionByTitlePrefix(page: typeof privacyPolicy, prefix: string) {
  return page.sections.find((section) => section.title.startsWith(prefix));
}

function textOf(section: { paragraphs?: string[]; bullets?: string[] } | undefined): string {
  return [...(section?.paragraphs ?? []), ...(section?.bullets ?? [])].join(" ");
}

describe("privacy policy — AKIBA-MOB-002 §10.1", () => {
  it("identifies the mobile app, not just the web surfaces", () => {
    expect(privacyPolicy.intro).toMatch(/Akiba Pass mobile app/i);
    expect(privacyPolicy.intro).toMatch(/iOS and Android/i);
  });

  it("has a deletion section that points at the public page, not only an email", () => {
    const deletion = sectionByTitlePrefix(privacyPolicy, "9.");
    expect(deletion?.title).toMatch(/Deleting Your Account/i);
    const text = textOf(deletion);
    expect(text).toContain("/account-deletion");
    // §6: "The default path must not be mailto:". Support is the fallback
    // for a lost email, which the section still has to mention.
    expect(text).toMatch(/Settings/);
    expect(text).toMatch(/lost access to your account email/i);
  });

  it("states the policy version the app sends back on acknowledgement", () => {
    // Drift guard: the published version and the version the request API
    // accepts must be the same string, or every submission from a build
    // showing this copy would be rejected as stale.
    const text = textOf(sectionByTitlePrefix(privacyPolicy, "9."));
    expect(text).toContain(DELETION_POLICY_VERSION);
  });

  it("distinguishes deletion from legal retention and restricted processing", () => {
    const rights = textOf(sectionByTitlePrefix(privacyPolicy, "8."));
    const deletion = textOf(sectionByTitlePrefix(privacyPolicy, "9."));
    expect(rights).toMatch(/pseudonymised/i);
    expect(rights).toMatch(/restricted processing/i);
    expect(deletion).toMatch(/pseudonymised/i);
    expect(deletion).toMatch(/retention period/i);
  });

  it("discloses on-chain immutability inside the deletion section, not only in the chain section", () => {
    const deletion = textOf(sectionByTitlePrefix(privacyPolicy, "9."));
    expect(deletion).toMatch(/Celo/);
    expect(deletion).toMatch(/permanent and public/i);
    expect(deletion).toMatch(/cannot remove anything from the blockchain/i);
  });

  it("describes location use and whether coordinates are kept", () => {
    const collected = textOf(sectionByTitlePrefix(privacyPolicy, "1."));
    expect(collected).toMatch(/location/i);
    expect(collected).toMatch(/not stored against your profile/i);
    expect(collected).toMatch(/never collects location in the background/i);
  });

  it("names the 14-day processing target the app and the public page promise", () => {
    expect(textOf(sectionByTitlePrefix(privacyPolicy, "9."))).toMatch(/14 calendar days/);
  });

  it("keeps section numbering contiguous after the insertion", () => {
    const numbers = privacyPolicy.sections.map((section) => Number.parseInt(section.title, 10));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
  });
});

describe("terms — AKIBA-MOB-002 §10.1", () => {
  it("explains the deletion effect on Miles and on vouchers", () => {
    expect(textOf(sectionByTitlePrefix(termsOfUse, "4."))).toMatch(/delete your account/i);
    expect(textOf(sectionByTitlePrefix(termsOfUse, "6."))).toMatch(/becomes unusable/i);
  });

  it("points to the deletion path from the privacy section", () => {
    const privacySection = sectionByTitlePrefix(termsOfUse, "11.");
    expect(privacySection?.title).toMatch(/Account Deletion/i);
    expect(textOf(privacySection)).toContain("/account-deletion");
  });

  it("keeps the 18+ requirement the store age rating is based on", () => {
    expect(textOf(sectionByTitlePrefix(termsOfUse, "3."))).toMatch(/at least 18 years old/i);
  });
});

describe("legal surface parity", () => {
  it("keeps hub-page and website legal content byte-identical apart from hub-page's header comment", () => {
    // Two policies that read differently depending on which Akiba surface
    // opened them would be a real legal inconsistency. §10.1 requires both
    // to change in one commit, so this test fails if only one did.
    const hub = readFileSync(path.join(process.cwd(), "src/content/legal.ts"), "utf8");
    const websitePath = path.join(process.cwd(), "../website/src/content/legal.ts");
    expect(existsSync(websitePath)).toBe(true);
    const website = readFileSync(websitePath, "utf8");

    const stripHeader = (source: string) =>
      source.slice(source.indexOf("export type LegalSection")).trim();
    expect(stripHeader(hub)).toBe(stripHeader(website));
  });

  it("serves the same deletion URL in the config contract that the page is mounted at", () => {
    // §15.1 "public page/config URL parity": the URL the app and the store
    // listings read must be the route that actually exists.
    const links = getLegalLinks("https://app.akibamiles.com");
    expect(links.accountDeletionUrl).toBe("https://app.akibamiles.com/account-deletion");
    expect(existsSync(path.join(process.cwd(), "src/app/account-deletion/page.tsx"))).toBe(true);
    expect(links.privacyUrl).toBe("https://app.akibamiles.com/privacy-policy");
    expect(existsSync(path.join(process.cwd(), "src/app/privacy-policy/page.tsx"))).toBe(true);
    expect(links.termsUrl).toBe("https://app.akibamiles.com/terms-of-use");
    expect(existsSync(path.join(process.cwd(), "src/app/terms-of-use/page.tsx"))).toBe(true);
  });
});
