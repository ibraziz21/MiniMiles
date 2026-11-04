/**
 * These helpers are hand-mirrored from the Pass app, so they can drift. The
 * cases that matter are the ones where being wrong is invisible: claiming a
 * shop is closed all week when it simply hasn't supplied hours, and the
 * overnight range that schema.org expresses by letting `closes` precede
 * `opens`.
 */
import { describe, it, expect } from "vitest";
import { formatWeekHours, toOpeningHoursSpecification } from "@/lib/directory/hours";
import type { OpeningHours } from "@/lib/directory/types";

const HOURS: OpeningHours = {
  version: 1,
  monday: [{ opens: "07:00", closes: "19:00" }],
  tuesday: [{ opens: "07:00", closes: "19:00" }],
  saturday: [{ opens: "08:00", closes: "22:00" }],
  sunday: [],
};

describe("formatWeekHours", () => {
  it("returns nothing when the merchant hasn't supplied hours", () => {
    // An empty array lets the page omit the section; seven "Closed" rows
    // would assert the shop never opens, which we don't know.
    expect(formatWeekHours(null)).toEqual([]);
    expect(formatWeekHours(undefined)).toEqual([]);
    expect(formatWeekHours({})).toEqual([]);
  });

  it("lists all seven days, Monday first", () => {
    const week = formatWeekHours(HOURS);
    expect(week.map((d) => d.label)).toEqual([
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]);
  });

  it("renders a supplied range and marks an explicitly empty day closed", () => {
    const week = formatWeekHours(HOURS);
    expect(week[0]).toEqual({ label: "Monday", text: "07:00–19:00" });
    expect(week[6]).toEqual({ label: "Sunday", text: "Closed" });
  });

  it("treats a day with no entry as closed", () => {
    const week = formatWeekHours(HOURS);
    expect(week[2]).toEqual({ label: "Wednesday", text: "Closed" });
  });

  it("joins split shifts on one line", () => {
    const week = formatWeekHours({
      version: 1,
      monday: [{ opens: "07:00", closes: "11:00" }, { opens: "17:00", closes: "22:00" }],
    });
    expect(week[0].text).toBe("07:00–11:00, 17:00–22:00");
  });
});

describe("toOpeningHoursSpecification", () => {
  it("is empty when there are no hours, so no empty property is emitted", () => {
    expect(toOpeningHoursSpecification(null)).toEqual([]);
    expect(toOpeningHoursSpecification({})).toEqual([]);
  });

  it("emits one entry per range, with schema.org day URLs", () => {
    expect(toOpeningHoursSpecification(HOURS)).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Monday", opens: "07:00", closes: "19:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Tuesday", opens: "07:00", closes: "19:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Saturday", opens: "08:00", closes: "22:00" },
    ]);
  });

  it("emits a separate entry per shift on the same day", () => {
    const spec = toOpeningHoursSpecification({
      version: 1,
      friday: [{ opens: "07:00", closes: "11:00" }, { opens: "17:00", closes: "22:00" }],
    });
    expect(spec).toHaveLength(2);
    expect(spec.every((s) => s.dayOfWeek === "https://schema.org/Friday")).toBe(true);
  });

  it("passes an overnight range through unchanged", () => {
    // schema.org reads closes < opens as closing the next day, so inverting
    // or splitting it here would misstate the hours.
    const spec = toOpeningHoursSpecification({
      version: 1,
      friday: [{ opens: "22:00", closes: "02:00" }],
    });
    expect(spec).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Friday", opens: "22:00", closes: "02:00" },
    ]);
  });

  it("ignores hours with no version marker, like the display helper", () => {
    expect(toOpeningHoursSpecification({ monday: [{ opens: "07:00", closes: "19:00" }] })).toEqual([]);
  });
});
