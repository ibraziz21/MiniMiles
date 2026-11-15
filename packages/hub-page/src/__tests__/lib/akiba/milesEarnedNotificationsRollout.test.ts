import { describe, expect, it } from "vitest";

import {
  isMilesEarnedNotificationEnabledFor,
  isMilesEarnedNotificationsEnabledForMember,
} from "@/lib/akiba/milesEarnedNotificationsRollout";

const MEMBER = { hubUserId: "8B0F6C1E-0000-4000-8000-000000000001", email: "Pilot@Akiba.test" };

describe("Miles-earned rollout gate", () => {
  it("is off unless explicitly enabled", () => {
    expect(isMilesEarnedNotificationsEnabledForMember(MEMBER, {})).toBe(false);
  });

  it("matches an allowlisted email or user id, case-insensitively", () => {
    const byEmail = { HUB_MILES_EARNED_NOTIFICATIONS_ENABLED: "true", HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST: "pilot@akiba.test" };
    const byId = { HUB_MILES_EARNED_NOTIFICATIONS_ENABLED: "true", HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST: MEMBER.hubUserId.toLowerCase() };
    expect(isMilesEarnedNotificationsEnabledForMember(MEMBER, byEmail)).toBe(true);
    expect(isMilesEarnedNotificationsEnabledForMember({ hubUserId: MEMBER.hubUserId }, byId)).toBe(true);
    expect(isMilesEarnedNotificationsEnabledForMember({ hubUserId: MEMBER.hubUserId }, byEmail)).toBe(false);
  });

  it("puts a member in the same bucket whether or not the email is known", () => {
    // The app's capability check knows the email; the sender only has the id.
    // They must agree for every member at every percentage.
    for (let percent = 1; percent < 100; percent += 7) {
      const env = { HUB_MILES_EARNED_NOTIFICATIONS_ENABLED: "true", HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT: String(percent) };
      for (let index = 0; index < 50; index += 1) {
        const hubUserId = `8b0f6c1e-0000-4000-8000-${String(index).padStart(12, "0")}`;
        expect(isMilesEarnedNotificationEnabledFor({ hubUserId }, "m", env)).toBe(
          isMilesEarnedNotificationsEnabledForMember({ hubUserId, email: `member${index}@akiba.test` }, env),
        );
      }
    }
  });

  it("still applies the pilot-merchant cohort at send time", () => {
    const env = {
      HUB_MILES_EARNED_NOTIFICATIONS_ENABLED: "true",
      HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT: "100",
      HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST: "pilot-merchant",
    };
    expect(isMilesEarnedNotificationEnabledFor(MEMBER, "pilot-merchant", env)).toBe(true);
    expect(isMilesEarnedNotificationEnabledFor(MEMBER, "other-merchant", env)).toBe(false);
  });
});
