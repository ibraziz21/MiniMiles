import { describe, expect, it } from "vitest";
import {
  PUSH_PROMPT_SNOOZE_MS,
  shouldOfferPushPrompt,
  wasPushPromptRecentlyDismissed,
} from "@/lib/push/prompt";

const eligible = {
  signedIn: true,
  supported: true,
  standalone: true,
  permission: "default" as const,
  hasSubscription: false,
  hasVapidKey: true,
  recentlyDismissed: false,
};

describe("push opt-in prompt eligibility", () => {
  it("offers the prompt to an eligible signed-in PWA user", () => {
    expect(shouldOfferPushPrompt(eligible)).toBe(true);
  });

  it.each([
    ["signed out", { signedIn: false }],
    ["unsupported", { supported: false }],
    ["not installed", { standalone: false }],
    ["already subscribed", { permission: "granted" as const, hasSubscription: true }],
    ["permission denied", { permission: "denied" as const }],
    ["VAPID unavailable", { hasVapidKey: false }],
    ["recently dismissed", { recentlyDismissed: true }],
  ])("does not offer when %s", (_label, overrides) => {
    expect(shouldOfferPushPrompt({ ...eligible, ...overrides })).toBe(false);
  });

  it("snoozes a dismissal for fourteen days", () => {
    const now = Date.UTC(2026, 7, 5);
    expect(wasPushPromptRecentlyDismissed(String(now - PUSH_PROMPT_SNOOZE_MS + 1), now)).toBe(true);
    expect(wasPushPromptRecentlyDismissed(String(now - PUSH_PROMPT_SNOOZE_MS), now)).toBe(false);
    expect(wasPushPromptRecentlyDismissed("not-a-timestamp", now)).toBe(false);
  });
});
