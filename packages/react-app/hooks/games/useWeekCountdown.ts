"use client";

import { useEffect, useState } from "react";

/** ms until Sunday 23:59:59 UTC (= next Mon 00:00:00 UTC) */
function msUntilWeekClose() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun…6=Sat
  const daysUntilMonday = day === 0 ? 1 : 8 - day; // days from now until next Monday
  const nextMonday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
  ));
  return nextMonday.getTime() - now.getTime();
}

/** Live-ticking "Xd left" / "HH:MM:SS" countdown to the current ISO week's close. */
export function useWeekCountdown() {
  const [ms, setMs] = useState(msUntilWeekClose);
  useEffect(() => {
    const id = setInterval(() => setMs(msUntilWeekClose()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalSeconds = Math.floor(ms / 1000);
  const days  = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins  = Math.floor((totalSeconds % 3600) / 60);
  const secs  = totalSeconds % 60;

  if (days > 1) return `${days}d left`;
  if (days === 1) return `1d ${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  return `${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
}
