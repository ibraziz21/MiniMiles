"use client";

import { useState } from "react";

type Point = { date: string; signups: number };
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  });

export function SignupChart({ daily }: { daily: Point[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!daily.length)
    return (
      <p className="py-12 text-sm text-white/80">
        No signup data for this period.
      </p>
    );
  const maximum = Math.max(1, ...daily.map((p) => p.signups));
  const x = (i: number) => 8 + (i / Math.max(1, daily.length - 1)) * 344;
  const y = (value: number) => 124 - (value / maximum) * 104;
  const path = daily
    .map(
      (p, i) => `${i ? "L" : "M"} ${x(i).toFixed(2)} ${y(p.signups).toFixed(2)}`
    )
    .join(" ");
  const point = selected === null ? null : daily[selected];
  return (
    <div className="mt-2">
      <div
        className="flex min-h-7 items-center justify-between gap-2 text-xs text-white/80"
        aria-live="polite"
      >
        <span>
          {point
            ? `${dateLabel(point.date)} · ${point.signups.toLocaleString(
                "en-KE"
              )} signups`
            : "Daily signups"}
        </span>
        <span>
          Peak{" "}
          {Math.max(...daily.map((p) => p.signups)).toLocaleString("en-KE")}
        </span>
      </div>
      <svg
        viewBox="0 0 360 144"
        preserveAspectRatio="none"
        className="h-28 w-full sm:h-40"
        role="img"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const fraction =
            (((event.clientX - bounds.left) / bounds.width) * 360 - 8) / 344;
          setSelected(
            Math.max(
              0,
              Math.min(
                daily.length - 1,
                Math.round(fraction * (daily.length - 1))
              )
            )
          );
        }}
        aria-label={`Daily Pass signups from ${dateLabel(
          daily[0].date
        )} to ${dateLabel(
          daily[daily.length - 1].date
        )}. Tap the chart or use the date control or data table below for exact values.`}
      >
        {[20, 72, 124].map((v) => (
          <line
            key={v}
            x1="8"
            x2="352"
            y1={v}
            y2={v}
            stroke="white"
            strokeOpacity="0.12"
            strokeDasharray="3 5"
          />
        ))}
        <path
          d={`${path} L ${x(daily.length - 1)} 124 L 8 124 Z`}
          fill="#80d5cb"
          fillOpacity="0.08"
        />
        <path
          d={path}
          fill="none"
          stroke="#80d5cb"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {selected !== null && (
          <circle
            cx={x(selected)}
            cy={y(daily[selected].signups)}
            r="4"
            fill="#242225"
            stroke="#80d5cb"
            strokeWidth="2"
          />
        )}
      </svg>
      <div
        className="flex justify-between text-xs text-white/75"
        aria-hidden="true"
      >
        {[
          0,
          Math.floor((daily.length - 1) / 3),
          Math.floor((2 * (daily.length - 1)) / 3),
          daily.length - 1,
        ].map((i, index) => (
          <span key={index}>{dateLabel(daily[i].date)}</span>
        ))}
      </div>
      <details className="mt-1 text-sm text-white/80">
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          Explore data
        </summary>
        <label className="mt-1 flex min-h-11 items-center gap-3 text-xs text-white/80">
          <span className="shrink-0">Inspect date</span>
          <input
            type="range"
            min="0"
            max={daily.length - 1}
            value={selected ?? daily.length - 1}
            onChange={(e) => setSelected(Number(e.target.value))}
            aria-valuetext={`${dateLabel(
              daily[selected ?? daily.length - 1].date
            )}, ${daily[selected ?? daily.length - 1].signups} signups`}
            className="h-11 min-w-0 flex-1 accent-[#80d5cb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          />
        </label>
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">
              Daily Pass signups, Nairobi dates
            </caption>
            <thead>
              <tr>
                <th scope="col" className="py-2">
                  Date
                </th>
                <th scope="col" className="text-right">
                  Signups
                </th>
              </tr>
            </thead>
            <tbody>
              {daily.map((p) => (
                <tr key={p.date} className="border-t border-white/10">
                  <th scope="row" className="py-2 font-normal">
                    {dateLabel(p.date)}
                  </th>
                  <td className="text-right">
                    {p.signups.toLocaleString("en-KE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
