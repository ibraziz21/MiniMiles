/**
 * Unit tests for referral domain helpers (referral-system-spec.md §5.2,
 * §10.4): code normalization/format, click-signal hashing, invite URL
 * construction, and the privacy-safe friend label.
 */
import { describe, it, expect } from "vitest";

process.env.HUB_REFERRAL_SECRET = "b".repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = "https://hub.akibamiles.com";

const {
  normalizeReferralCode,
  isPlausibleReferralCode,
  buildReferralUrl,
  hashClickSignal,
  friendLabel,
} = await import("@/lib/akiba/referral");

describe("normalizeReferralCode", () => {
  it("upper-cases and trims", () => {
    expect(normalizeReferralCode("  ab3d5f7h  ")).toBe("AB3D5F7H");
  });
});

describe("isPlausibleReferralCode", () => {
  it("accepts 8 characters from the Crockford Base32 alphabet", () => {
    expect(isPlausibleReferralCode("23456789")).toBe(true);
    expect(isPlausibleReferralCode("ABCDEFGH")).toBe(true);
  });

  it("rejects codes containing the excluded ambiguous characters I, L, O, U", () => {
    for (const ch of ["I", "L", "O", "U"]) {
      expect(isPlausibleReferralCode(`ABCDEFG${ch}`)).toBe(false);
    }
  });

  it("rejects the wrong length", () => {
    expect(isPlausibleReferralCode("ABCDEFG")).toBe(false);
    expect(isPlausibleReferralCode("ABCDEFGHI".slice(0, 9))).toBe(false);
  });

  it("rejects lowercase input (callers must normalize first)", () => {
    expect(isPlausibleReferralCode("abcdefgh")).toBe(false);
  });
});

describe("buildReferralUrl", () => {
  it("builds a canonical /r/<code> link from the site URL, without a trailing slash duplication", () => {
    expect(buildReferralUrl("AB3D5F7H")).toBe("https://hub.akibamiles.com/r/AB3D5F7H");
  });
});

describe("hashClickSignal", () => {
  it("is deterministic for the same value and domain", () => {
    expect(hashClickSignal("1.2.3.4", "ip")).toBe(hashClickSignal("1.2.3.4", "ip"));
  });

  it("differs by domain label even for the same raw value (no cross-purpose collision)", () => {
    expect(hashClickSignal("same-value", "ip")).not.toBe(hashClickSignal("same-value", "device"));
  });

  it("never returns the raw input", () => {
    expect(hashClickSignal("1.2.3.4", "ip")).not.toContain("1.2.3.4");
  });
});

describe("friendLabel", () => {
  it("never exposes email/phone/wallet — generic label only in V1", () => {
    expect(friendLabel()).toBe("A friend");
  });
});
