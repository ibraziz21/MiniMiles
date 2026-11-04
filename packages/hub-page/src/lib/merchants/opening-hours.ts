import type { OpeningHours, OpeningHoursRange } from "./types";

const DAY_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday",
};

const SCHEMA_DAY_URLS: Record<DayKey, string> = {
  sunday: "https://schema.org/Sunday",
  monday: "https://schema.org/Monday",
  tuesday: "https://schema.org/Tuesday",
  wednesday: "https://schema.org/Wednesday",
  thursday: "https://schema.org/Thursday",
  friday: "https://schema.org/Friday",
  saturday: "https://schema.org/Saturday",
};

function partsInTimezone(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayShort = get("weekday").toLowerCase();
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  const weekdayMap: Record<string, DayKey> = {
    sun: "sunday", mon: "monday", tue: "tuesday", wed: "wednesday",
    thu: "thursday", fri: "friday", sat: "saturday",
  };

  return { day: weekdayMap[weekdayShort], minutesOfDay: hour * 60 + minute };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * A range like { opens: "22:00", closes: "02:00" } spans midnight; treat
 * `closes` as belonging to the next day.
 */
function rangeContains(range: OpeningHoursRange, minutesOfDay: number): boolean {
  const opens = toMinutes(range.opens);
  const closes = toMinutes(range.closes);
  if (closes > opens) return minutesOfDay >= opens && minutesOfDay < closes;
  // overnight range
  return minutesOfDay >= opens || minutesOfDay < closes;
}

export function isOpenNow(hours: OpeningHours | null | undefined, timezone: string): boolean | null {
  if (!hours || !hours.version) return null;
  const { day, minutesOfDay } = partsInTimezone(timezone, new Date());

  const todayRanges = hours[day] ?? [];
  if (todayRanges.some((r) => rangeContains(r, minutesOfDay))) return true;

  // Yesterday's overnight range can still be open today (e.g. Mon 22:00–02:00
  // covers Tue 00:00–02:00) regardless of whether today has its own hours.
  const prevDay = DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7];
  const prevRanges = hours[prevDay] ?? [];
  return prevRanges.some((r) => toMinutes(r.closes) <= toMinutes(r.opens) && rangeContains(r, minutesOfDay));
}

export function formatTodayHours(hours: OpeningHours | null | undefined, timezone: string): string {
  if (!hours || !hours.version) return "Hours not provided";
  const { day } = partsInTimezone(timezone, new Date());
  const ranges = hours[day] ?? [];
  if (ranges.length === 0) return "Closed today";
  return ranges.map((r) => `${r.opens}–${r.closes}`).join(", ");
}

export type OpeningHoursSpecification = {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string;
  opens: string;
  closes: string;
};

/**
 * schema.org form of the same hours the profile already shows. An overnight
 * range stays as-is: schema.org reads `closes` earlier than `opens` as
 * closing the following day, which matches `rangeContains` above.
 */
export function toOpeningHoursSpecification(
  hours: OpeningHours | null | undefined
): OpeningHoursSpecification[] {
  if (!hours || !hours.version) return [];
  const spec: OpeningHoursSpecification[] = [];
  for (const key of DAY_KEYS) {
    for (const range of hours[key] ?? []) {
      spec.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: SCHEMA_DAY_URLS[key],
        opens: range.opens,
        closes: range.closes,
      });
    }
  }
  return spec;
}

export function formatWeekHours(hours: OpeningHours | null | undefined): Array<{ label: string; text: string }> {
  if (!hours || !hours.version) return [];
  return DAY_KEYS.map((key) => {
    const ranges = hours[key] ?? [];
    return {
      label: DAY_LABELS[key],
      text: ranges.length === 0 ? "Closed" : ranges.map((r) => `${r.opens}–${r.closes}`).join(", "),
    };
  });
}
