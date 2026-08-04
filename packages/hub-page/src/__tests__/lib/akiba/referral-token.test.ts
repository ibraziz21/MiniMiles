/**
 * Unit tests for the referral attribution cookie signer/verifier
 * (referral-system-spec.md §3.2, §15).
 */
import { describe, it, expect } from "vitest";

process.env.HUB_REFERRAL_SECRET = "a".repeat(32);

const { createReferralToken, verifyReferralCookie } = await import("@/lib/akiba/referral-token");

describe("referral attribution token", () => {
  it("round-trips: verifying a freshly signed cookie yields the stored token_hash", () => {
    const { cookieValue, tokenHash } = createReferralToken();
    expect(verifyReferralCookie(cookieValue)).toBe(tokenHash);
  });

  it("produces a different token/hash on every call", () => {
    const a = createReferralToken();
    const b = createReferralToken();
    expect(a.cookieValue).not.toBe(b.cookieValue);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("rejects a tampered raw-token portion", () => {
    const { cookieValue } = createReferralToken();
    const dot = cookieValue.lastIndexOf(".");
    const tampered = `${cookieValue.slice(0, dot - 1)}x${cookieValue.slice(dot - 1)}`;
    expect(verifyReferralCookie(tampered)).toBeNull();
  });

  it("rejects a tampered signature portion", () => {
    const { cookieValue } = createReferralToken();
    // Flip a character a few positions into the signature (not its very
    // last character — base64url's final char can carry unused padding
    // bits, so mutating only that one doesn't reliably change the decoded
    // byte value — and not the dot separator itself).
    const dot = cookieValue.lastIndexOf(".");
    const idx = dot + 5;
    const flipped = cookieValue[idx] === "A" ? "B" : "A";
    const tampered = cookieValue.slice(0, idx) + flipped + cookieValue.slice(idx + 1);
    expect(verifyReferralCookie(tampered)).toBeNull();
  });

  it("rejects a value with no signature separator", () => {
    expect(verifyReferralCookie("not-a-valid-token")).toBeNull();
  });

  it("rejects null/undefined/empty input", () => {
    expect(verifyReferralCookie(null)).toBeNull();
    expect(verifyReferralCookie(undefined)).toBeNull();
    expect(verifyReferralCookie("")).toBeNull();
  });

  it("hashes the same raw token deterministically across both output fields", () => {
    // tokenHash is derived from the raw component that also feeds the
    // signature — re-deriving it here via verify should always agree.
    const results = Array.from({ length: 5 }, () => createReferralToken());
    for (const r of results) {
      expect(verifyReferralCookie(r.cookieValue)).toBe(r.tokenHash);
    }
  });
});
