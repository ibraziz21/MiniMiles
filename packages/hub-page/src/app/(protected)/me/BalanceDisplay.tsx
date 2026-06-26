"use client";

import { useEffect, useState } from "react";

export function BalanceDisplay() {
  const [miles, setMiles] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => setMiles(data.akiba_miles ?? 0))
      .catch(() => setMiles(0));
  }, []);

  if (miles === null) {
    return (
      <span className="inline-block h-12 w-40 animate-pulse rounded-lg bg-white/10" />
    );
  }

  return (
    <>
      {miles.toLocaleString("en-KE")}
      <span className="ml-2 text-2xl font-normal text-white/40">miles</span>
    </>
  );
}
