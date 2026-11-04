import type { OpeningHours } from "./types";

const DAY_KEYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

const SCHEMA_DAY_URLS: Record<DayKey, string> = {
  monday: "https://schema.org/Monday",
  tuesday: "https://schema.org/Tuesday",
  wednesday: "https://schema.org/Wednesday",
  thursday: "https://schema.org/Thursday",
  friday: "https://schema.org/Friday",
  saturday: "https://schema.org/Saturday",
  sunday: "https://schema.org/Sunday",
};

/**
 * Week grid for display, Monday first. Returns an empty array for hours the
 * merchant hasn't supplied, so the page can omit the section rather than
 * render seven "Closed" rows and claim the shop never opens.
 */
export function formatWeekHours(
  hours: OpeningHours | null | undefined
): Array<{ label: string; text: string }> {
  if (!hours || !hours.version) return [];
  return DAY_KEYS.map((key) => {
    const ranges = hours[key] ?? [];
    return {
      label: DAY_LABELS[key],
      text: ranges.length === 0 ? "Closed" : ranges.map((r) => `${r.opens}–${r.closes}`).join(", "),
    };
  });
}

export type OpeningHoursSpecification = {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string;
  opens: string;
  closes: string;
};

/**
 * schema.org form of the same hours. An overnight range is passed through
 * as-is: schema.org reads a `closes` earlier than `opens` as closing the
 * following day.
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
