import { describe, expect, it } from "vitest";
import { checkDailyVoucherRateLimit } from "@/lib/server/dailyVoucherRateLimit";

describe("checkDailyVoucherRateLimit", () => {
  it("allows a legitimate same-day retry burst after wallet rejection", () => {
    const wallet = "0x0000000000000000000000000000000000aaa1";
    const ip = "203.0.113.10";

    // A handful of quick retries (rejection → tap again) must never be blocked.
    for (let i = 0; i < 5; i++) {
      expect(checkDailyVoucherRateLimit(ip, wallet)).toEqual({ ok: true });
    }
  });

  it("blocks a wallet once it exceeds the per-wallet burst threshold", () => {
    const wallet = "0x0000000000000000000000000000000000aaa2";
    const ip = "203.0.113.11";

    let lastResult;
    for (let i = 0; i < 20; i++) {
      lastResult = checkDailyVoucherRateLimit(ip, wallet);
    }
    expect(lastResult).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("blocks an IP that cycles through many wallets before any single wallet trips its own limit", () => {
    const ip = "203.0.113.12";
    let lastResult;
    for (let i = 0; i < 40; i++) {
      lastResult = checkDailyVoucherRateLimit(ip, `0x000000000000000000000000000000000000${String(i).padStart(2, "0")}`);
    }
    expect(lastResult).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("keeps wallets on different IPs independent", () => {
    const walletA = "0x0000000000000000000000000000000000bbb1";
    const walletB = "0x0000000000000000000000000000000000bbb2";
    expect(checkDailyVoucherRateLimit("198.51.100.1", walletA)).toEqual({ ok: true });
    expect(checkDailyVoucherRateLimit("198.51.100.2", walletB)).toEqual({ ok: true });
  });
});
