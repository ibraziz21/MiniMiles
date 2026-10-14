import type { MerchantOffer } from '@/contracts';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const weekday = get('weekday');
    if (!weekday || DAY_INDEX[weekday] == null) return null;
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      day: DAY_INDEX[weekday],
      minutes: Number(get('hour')) * 60 + Number(get('minute')),
    };
  } catch {
    return null;
  }
}

function toMinutes(value: string | null) {
  if (!value) return null;
  const [hour, minute] = value.split(':').map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

function displayTime(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function merchantOfferAvailability(offer: MerchantOffer, now = new Date()) {
  const dateRange = offer.startsOn || offer.endsOn
    ? [offer.startsOn ? `From ${offer.startsOn}` : null, offer.endsOn ? `until ${offer.endsOn}` : null].filter(Boolean).join(' ')
    : null;
  const scheduleLabel = offer.schedule === 'always'
    ? dateRange ?? 'Available every day'
    : [
        offer.daysOfWeek.map((day) => DAY_NAMES[day]).filter(Boolean).join(', ') || 'Selected days',
        offer.startTime && offer.endTime ? `${displayTime(offer.startTime)}–${displayTime(offer.endTime)}` : null,
        dateRange,
      ].filter(Boolean).join(' · ');
  const local = localParts(now, offer.timezone);
  if (!local || (offer.startsOn && local.date < offer.startsOn)) return { state: 'upcoming' as const, label: 'Upcoming', scheduleLabel };
  if (offer.endsOn && local.date > offer.endsOn) return { state: 'ended' as const, label: 'Ended', scheduleLabel };
  if (offer.schedule === 'always') return { state: 'available' as const, label: 'Available now', scheduleLabel };

  const start = toMinutes(offer.startTime);
  const end = toMinutes(offer.endTime);
  const selectedToday = offer.daysOfWeek.includes(local.day);
  let available = selectedToday;
  if (start != null && end != null) {
    available = start <= end
      ? selectedToday && local.minutes >= start && local.minutes < end
      : (selectedToday && local.minutes >= start) || (offer.daysOfWeek.includes((local.day + 6) % 7) && local.minutes < end);
  }
  return available
    ? { state: 'available' as const, label: 'Available now', scheduleLabel }
    : { state: 'upcoming' as const, label: 'Upcoming', scheduleLabel };
}
