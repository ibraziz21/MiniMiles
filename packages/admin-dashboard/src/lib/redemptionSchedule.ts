export type RedemptionSchedule = { days: number[]; timezone: string };

/** null means unrestricted; malformed input is rejected, never made unrestricted. */
export function isRedemptionSchedule(value: unknown): value is RedemptionSchedule | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schedule = value as Record<string, unknown>;
  return Array.isArray(schedule.days) && schedule.days.length > 0 && schedule.days.length <= 7 &&
    new Set(schedule.days).size === schedule.days.length &&
    schedule.days.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6) &&
    typeof schedule.timezone === "string" && schedule.timezone.trim().length > 0;
}

export function redemptionScheduleLabel(value: unknown): string {
  if (!isRedemptionSchedule(value)) return "Invalid redemption schedule — needs review";
  if (value === null) return "Any day while valid";
  return `${value.days.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")} (${value.timezone})`;
}
