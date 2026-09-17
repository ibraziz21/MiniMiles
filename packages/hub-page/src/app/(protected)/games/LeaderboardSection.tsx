"use client";

// Leaderboards as a first-class section of the games home, not something
// buried inside each game (skill-games-leaderboards-spec.md §5.2 — Hub games
// home "can show a compact personal rank link" is superseded here by a full
// section per your direction). Owns its own game-type switcher; period
// (Today/This week) tabs stay inside the shared LeaderboardCard.
//
// Client-only, same reason LeaderboardPageClient exists: a Server Component
// can't pass fetchLeaderboard (a function) across the RSC boundary as a prop.

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Trophy } from "lucide-react";
import { LeaderboardCard } from "@akiba/skill-games/components";
import type { GameType } from "@akiba/skill-games/core";
import { MilesIcon } from "@/components/MilesIcon";
import { track } from "@/lib/analytics/track";
import { fetchLeaderboard } from "@/lib/games/clientTransport";

const GAME_TABS: Array<{ type: GameType; label: string }> = [
  { type: "rule_tap", label: "Rule Tap" },
  { type: "memory_flip", label: "Memory Flip" },
];

function isGameType(value: string | null): value is GameType {
  return value === "rule_tap" || value === "memory_flip";
}

export function LeaderboardSection() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialGameType = isGameType(searchParams.get("gameType")) ? (searchParams.get("gameType") as GameType) : "rule_tap";
  const [gameType, setGameType] = useState<GameType>(initialGameType);
  const sectionRef = useRef<HTMLDivElement>(null);

  // Keep ?gameType= in sync so the /games/leaderboard legacy redirect's own
  // deep-link contract (and a shared link to this section) survives the
  // member actually touching the tabs, not just the initial load.
  function selectGameType(next: GameType) {
    setGameType(next);
    track("leaderboard_section_game_switch", { gameType: next });
    const params = new URLSearchParams(searchParams.toString());
    params.set("gameType", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (searchParams.get("section") === "leaderboard") {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only react to the initial deep-link — not on every param change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={sectionRef} id="leaderboard" className="mt-8 scroll-mt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-akiba-teal" aria-hidden="true" />
          <h2 className="font-sterling text-lg font-semibold text-akiba-ink">Leaderboards</h2>
        </div>
        <div className="flex gap-1 rounded-full bg-akiba-tint p-1" role="tablist" aria-label="Leaderboard game">
          {GAME_TABS.map((tab) => (
            <button
              key={tab.type}
              type="button"
              role="tab"
              aria-selected={gameType === tab.type}
              onClick={() => selectGameType(tab.type)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${
                gameType === tab.type ? "bg-akiba-teal text-white" : "text-akiba-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <LeaderboardCard
        gameType={gameType}
        fetchLeaderboard={fetchLeaderboard}
        milesIcon={<MilesIcon className="h-3 w-3" />}
        track={track}
      />
    </div>
  );
}
