"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function TrendPeriod({ days }: { days: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-sm font-medium text-ink">
      <span className="sr-only">Signup chart period</span>
      <select
        disabled={pending}
        value={days}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set("days", event.target.value);
          startTransition(() =>
            router.push(`/overview?${next}`, { scroll: false })
          );
        }}
        className="min-h-11 max-w-full bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
      >
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </select>
      {pending && (
        <span role="status" className="sr-only">
          Updating chart
        </span>
      )}
    </label>
  );
}
