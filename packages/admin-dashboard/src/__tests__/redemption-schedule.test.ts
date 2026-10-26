import { describe, it, expect } from "vitest";
import { isRedemptionSchedule, redemptionScheduleLabel } from "@/lib/redemptionSchedule";
describe("redemption schedule authoring", () => {
  it("keeps the unrestricted setting explicit", () => {
    expect(isRedemptionSchedule(null)).toBe(true);
    expect(redemptionScheduleLabel(null)).toBe("Any day while valid");
  });
  it("states redemption days independently of claiming", () => {
    expect(redemptionScheduleLabel({ days: [6,0], timezone: "Africa/Nairobi" })).toBe("Sat, Sun (Africa/Nairobi)");
  });
  it.each([undefined, {}, { days: [], timezone: "Africa/Nairobi" }, { days: [6,6], timezone: "Africa/Nairobi" }, { days: [7], timezone: "Africa/Nairobi" }, { days: [6], timezone: "" }, { days: ["6"], timezone: "Africa/Nairobi" }])("rejects malformed policy %j", (value) => {
    expect(isRedemptionSchedule(value)).toBe(false);
  });
});
