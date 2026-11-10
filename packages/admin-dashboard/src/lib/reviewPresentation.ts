export function safePublicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Display the shared merchant opening-hours schema, never raw JSON. */
export function openingHoursRows(
  value: unknown
): Array<{ day: string; hours: string }> {
  if (!value || typeof value !== "object")
    return [{ day: "Hours", hours: "Not supplied" }];
  const record = value as Record<string, unknown>;
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  const rows = days
    .filter((day) => Array.isArray(record[day]))
    .map((day) => {
      const periods = (record[day] as unknown[]).flatMap((period) => {
        if (!period || typeof period !== "object") return [];
        const p = period as Record<string, unknown>;
        return typeof p.opens === "string" &&
          typeof p.closes === "string" &&
          /^\d{2}:\d{2}$/.test(p.opens) &&
          /^\d{2}:\d{2}$/.test(p.closes)
          ? [`${p.opens}–${p.closes}`]
          : [];
      });
      return {
        day: day[0].toUpperCase() + day.slice(1),
        hours:
          (record[day] as unknown[]).length === 0
            ? "Closed"
            : periods.join(", ") || "Not supplied",
      };
    });
  return rows.length ? rows : [{ day: "Hours", hours: "Not supplied" }];
}
