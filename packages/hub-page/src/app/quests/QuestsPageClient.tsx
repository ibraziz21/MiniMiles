"use client";

// Active/Completed tabs + Miles summary + refresh-on-return
// (merchant-shopping-quests-spec.md §6 "Page structure"). Status is
// server-seeded, then refreshed from GET /api/quests/status whenever the tab
// regains focus (returning from an internal action route like /pass or
// /vouchers) — never trusts localStorage as authoritative completion state.
import { useEffect, useState, useCallback } from "react";
import { MilesAmount } from "@/components/MilesIcon";
import clsx from "clsx";
import { HubQuestCard } from "./HubQuestCard";
import type { HubQuestStatus } from "@/lib/akiba/questStatus";

type Tab = "active" | "completed";

export function QuestsPageClient({
  initialQuests,
  initialBalance,
  isSignedIn,
  rolloutEnabled,
}: {
  initialQuests: HubQuestStatus[];
  initialBalance: number;
  isSignedIn: boolean;
  rolloutEnabled: boolean;
}) {
  const [quests, setQuests] = useState(initialQuests);
  const [balance, setBalance] = useState(initialBalance);
  const [tab, setTab] = useState<Tab>("active");

  const refresh = useCallback(async () => {
    if (!isSignedIn || !rolloutEnabled) return;
    try {
      const res = await fetch("/api/quests/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { quests: HubQuestStatus[]; balance: number };
      setQuests(data.quests);
      setBalance(data.balance);
    } catch {
      // Platform/network hiccup — keep last-known state, don't blank the page.
    }
  }, [isSignedIn, rolloutEnabled]);

  useEffect(() => {
    function onFocus() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const completed = quests.filter((q) => q.state === "completed");
  const active = quests.filter((q) => q.state !== "completed");
  const shown = tab === "active" ? active : completed;

  if (isSignedIn && !rolloutEnabled) {
    return (
      <p className="rounded-2xl border border-dashed border-akiba-line bg-akiba-card px-6 py-8 text-center text-sm text-akiba-muted">
        Earn Miles quests are rolling out gradually — check back soon.
      </p>
    );
  }

  return (
    <div>
      {isSignedIn && (
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-akiba-line bg-white p-4 sm:mb-6">
          <span className="text-sm font-medium text-akiba-muted">Available Miles</span>
          <MilesAmount amount={balance} size="lg" className="font-semibold text-akiba-ink" />
        </div>
      )}

      <div className="mb-5 flex gap-1 rounded-full bg-akiba-card p-1 sm:mb-6" role="tablist">
        {(["active", "completed"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 rounded-full py-2 text-sm font-semibold capitalize transition sm:flex-none sm:px-6",
              tab === t ? "bg-white text-akiba-ink shadow-chip" : "text-akiba-muted",
            )}
          >
            {t} {t === "completed" && completed.length > 0 ? `(${completed.length})` : ""}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-akiba-line bg-akiba-card px-6 py-8 text-center text-sm text-akiba-muted">
          {tab === "active" ? "No active quests right now." : "No completed quests yet."}
        </p>
      ) : (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((q) => (
            <HubQuestCard key={q.key} quest={q} isSignedIn={isSignedIn} onClaimed={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
