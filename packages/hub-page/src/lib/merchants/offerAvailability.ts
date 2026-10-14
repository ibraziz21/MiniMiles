import type { PublicMerchantOffer } from "./types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type ZonedNow = {
  date: string;
  day: number;
  minutes: number;
};

export type MerchantOfferAvailability = {
  state: "available" | "upcoming" | "ended";
  label: "Available now" | "Upcoming" | "Ended";
  scheduleLabel: string;
};

function zonedNow(date: Date, timezone: string): ZonedNow | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const dayOfMonth = part("day");
    const weekday = part("weekday");
    const hour = Number(part("hour"));
    const minute = Number(part("minute"));
    if (!year || !month || !dayOfMonth || !weekday || WEEKDAY_INDEX[weekday] == null) return null;
    return {
      date: `${year}-${month}-${dayOfMonth}`,
      day: WEEKDAY_INDEX[weekday],
      minutes: hour * 60 + minute,
    };
  } catch {
    return null;
  }
}

function timeMinutes(value: string | null): number | null {
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

function formatTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function scheduleLabel(offer: PublicMerchantOffer): string {
  const dateRange = offer.startsOn || offer.endsOn
    ? [offer.startsOn ? `From ${offer.startsOn}` : null, offer.endsOn ? `until ${offer.endsOn}` : null]
        .filter(Boolean)
        .join(" ")
    : null;

  if (offer.schedule === "always") return dateRange ?? "Available every day";

  const days = offer.daysOfWeek.map((day) => DAY_NAMES[day]).filter(Boolean).join(", ");
  const hours = offer.startTime && offer.endTime
    ? `${formatTime(offer.startTime)}–${formatTime(offer.endTime)}`
    : null;
  return [days || "Selected days", hours, dateRange].filter(Boolean).join(" · ");
}

export function getMerchantOfferAvailability(
  offer: PublicMerchantOffer,
  now = new Date(),
): MerchantOfferAvailability {
  const local = zonedNow(now, offer.timezone);
  const details = scheduleLabel(offer);
  if (!local) return { state: "upcoming", label: "Upcoming", scheduleLabel: details };
  if (offer.endsOn && local.date > offer.endsOn) {
    return { state: "ended", label: "Ended", scheduleLabel: details };
  }
  if (offer.startsOn && local.date < offer.startsOn) {
    return { state: "upcoming", label: "Upcoming", scheduleLabel: details };
  }
  if (offer.schedule === "always") {
    return { state: "available", label: "Available now", scheduleLabel: details };
  }

  const start = timeMinutes(offer.startTime);
  const end = timeMinutes(offer.endTime);
  const selectedToday = offer.daysOfWeek.includes(local.day);
  let available = selectedToday;

  if (start != null && end != null) {
    if (start <= end) {
      available = selectedToday && local.minutes >= start && local.minutes < end;
    } else {
      const yesterday = (local.day + 6) % 7;
      available = (selectedToday && local.minutes >= start)
        || (offer.daysOfWeek.includes(yesterday) && local.minutes < end);
    }
  }

  return available
    ? { state: "available", label: "Available now", scheduleLabel: details }
    : { state: "upcoming", label: "Upcoming", scheduleLabel: details };
}
