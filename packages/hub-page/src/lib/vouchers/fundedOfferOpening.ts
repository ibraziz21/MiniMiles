import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";

const DAY_MS = 86_400_000;

/** Find a future point when customers can both claim and use the offer. */
export function nextFundedOfferOpening(
  offer: Pick<FundedOffer, "claimStartsAt" | "claimEndsAt" | "redemptionSchedule">,
  now: number,
): string | null {
  const starts = Date.parse(offer.claimStartsAt ?? "");
  const ends = Date.parse(offer.claimEndsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || Math.max(starts, now) >= ends) return null;

  const schedule = offer.redemptionSchedule;
  if (!schedule) return starts > now ? new Date(starts).toISOString() : null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const localDate = (time: number) => formatter.format(new Date(time));
  const first = Math.max(starts, now);
  const firstEventDay = schedule.startDate ? Date.parse(schedule.startDate) : -Infinity;
  let day = Math.max(Date.parse(localDate(first)), firstEventDay);

  // At most a week from the first possible day. If it is already open, the
  // customer can use the offer now and has no upcoming opening to be reminded of.
  for (let offset = 0; offset < 7; offset++, day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (schedule.endDate && date > schedule.endDate) return null;
    if (!schedule.days.includes(new Date(day).getUTCDay())) continue;

    // Find the start of the merchant's local date, accounting for UTC offsets
    // and daylight saving without assuming a local day always lasts 24 hours.
    let low = day - DAY_MS;
    let high = day + DAY_MS;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (localDate(mid) < date) low = mid;
      else high = mid;
    }
    if (localDate(high) !== date) continue;
    const opening = Math.max(starts, high);
    return opening > now && opening < ends ? new Date(opening).toISOString() : null;
  }
  return null;
}
