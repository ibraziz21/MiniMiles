"use client";

// Renders in place of RewardsSnapshot when getHomeFeed's balance fetch fails
// (MemberHome.tsx — feed.rewards is only ever null for a signed-in member
// when that fetch rejected). Previously this section just vanished with no
// explanation — the single highest-risk finding in the UX audit, since the
// Miles balance is the one number a loyalty-app member opens the app to
// check. This makes the failure visible and gives a one-tap way to retry
// instead of leaving the user to wonder whether their Miles are still there.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertCircle, RefreshCw } from "lucide-react";

export function RewardsSnapshotError() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [attempted, setAttempted] = useState(false);

  const retry = () => {
    setAttempted(true);
    startTransition(() => router.refresh());
  };

  return (
    <section className="mb-4 rounded-2xl border border-akiba-line bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-akiba-card">
          <AlertCircle className="h-5 w-5 text-akiba-muted" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-akiba-ink">Couldn&apos;t load your balance</p>
          <p className="text-xs text-akiba-muted">Your Miles are safe — we just couldn&apos;t reach them.</p>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={isPending}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-akiba-card px-3 text-xs font-semibold text-akiba-ink transition active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          {isPending ? "Retrying…" : "Retry"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {isPending ? "Retrying to load your balance" : attempted ? "Balance still unavailable" : ""}
      </p>
    </section>
  );
}
