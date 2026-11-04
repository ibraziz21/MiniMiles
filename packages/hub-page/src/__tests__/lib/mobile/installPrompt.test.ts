import { describe, expect, it } from "vitest";
import { APP_INSTALL_SNOOZE_MS, shouldOfferAppInstall, wasRecentlyDismissed } from "@/lib/mobile/installPrompt";
import { playStoreUrl } from "@/constants/links";

const now = 2_000_000_000_000;
describe("app install eligibility", () => {
  const eligible = { android: true, standalone: false, recentlyDismissed: false, pathname: "/" };
  it("offers Android visitors the app", () => expect(shouldOfferAppInstall(eligible)).toBe(true));
  it.each([
    { android: false }, { standalone: true }, { recentlyDismissed: true }, { pathname: "/welcome" },
  ])("suppresses ineligible visitors: %o", (override) => {
    expect(shouldOfferAppInstall({ ...eligible, ...override })).toBe(false);
  });
  it.each([null, "", " ", "invalid", "Infinity", "0", "-1", String(now + 1)])("ignores invalid dismissal %s", (value) => {
    expect(wasRecentlyDismissed(value, now)).toBe(false);
  });
  it("snoozes for exactly 14 days", () => {
    expect(wasRecentlyDismissed(String(now - APP_INSTALL_SNOOZE_MS + 1), now)).toBe(true);
    expect(wasRecentlyDismissed(String(now - APP_INSTALL_SNOOZE_MS), now)).toBe(false);
  });
  it("encodes campaign attribution inside the Play referrer", () => {
    const link = new URL(playStoreUrl("merchant & offer"));
    expect(link.searchParams.get("id")).toBe("com.akibamiles.akiba");
    const referrer = new URLSearchParams(link.searchParams.get("referrer")!);
    expect(Object.fromEntries(referrer)).toEqual({ utm_source: "hub", utm_medium: "web", utm_campaign: "merchant & offer" });
  });
});
