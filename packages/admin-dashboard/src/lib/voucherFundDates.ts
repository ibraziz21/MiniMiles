/** Admin funding windows always use Nairobi time, independently of browser TZ. */
export function toNairobiDateTimeInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
}
export function fromNairobiDateTimeInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Invalid Nairobi date/time");
  const date = new Date(value + ":00+03:00");
  if (!Number.isFinite(date.getTime()) || toNairobiDateTimeInput(date.toISOString()) !== value) throw new Error("Invalid Nairobi date/time");
  return date.toISOString();
}
