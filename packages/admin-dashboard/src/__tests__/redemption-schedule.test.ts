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
  it("retains exact event dates and rejects missing, impossible or reversed dates", () => {
    const schedule = { days: [6,0], timezone: "Africa/Nairobi", startDate: "2026-10-31", endDate: "2026-11-01" };
    expect(isRedemptionSchedule(schedule)).toBe(true);
    expect(redemptionScheduleLabel(schedule)).toContain("2026-10-31 through 2026-11-01");
    for (const invalid of [{...schedule,endDate:undefined},{...schedule,startDate:"2026-02-30"},{...schedule,endDate:"2026-10-30"}]) expect(isRedemptionSchedule(invalid)).toBe(false);
  });
  it.each([undefined, {}, { days: [], timezone: "Africa/Nairobi" }, { days: [6,6], timezone: "Africa/Nairobi" }, { days: [7], timezone: "Africa/Nairobi" }, { days: [6], timezone: "" }, { days: ["6"], timezone: "Africa/Nairobi" }])("rejects malformed policy %j", (value) => {
    expect(isRedemptionSchedule(value)).toBe(false);
  });
});
