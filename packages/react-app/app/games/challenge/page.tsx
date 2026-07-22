"use client";

// The weekly leaderboard's own destination — campaign frame, both game
// boards, prize zone, pinned rank, and last week's results. Per-game prize
// boards stay separate (no merged cross-game score). See
// docs/weekly-challenge-page-spec.md.

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import posthog from "posthog-js";
import { ArrowLeft, Timer, Lightning, Brain, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWeb3 } from "@/contexts/useWeb3";
import { useWeeklyCampaign, type WeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { useWeekCountdown } from "@/hooks/games/useWeekCountdown";
import { WEEKLY_GAME_TYPES, type GameType } from "@/lib/games/types";
import { EntryRow, PrizeZoneDivider, type EntryRowEntry } from "@/components/games/leaderboard-shared";
import { computeDeltaNudge, type StandingEntry } from "@/lib/games/deltaNudge";

const GAME_META: Record<GameType, { name: string; route: string; icon: PhosphorIcon }> = {
  rule_tap: { name: "Rule Tap", route: "/games/rule-tap", icon: Lightning },
  memory_flip: { name: "Memory Flip", route: "/games/memory-flip", icon: Brain },
};

function prizeChipLabel(rank: number, campaign: WeeklyCampaign | null): string | undefined {
  if (rank > 3) return undefined;
  const tier = campaign?.tiers.find((t) => t.rank === rank);
  if (tier?.label) return tier.label;
  return rank === 1 ? "🏆" : rank === 2 ? "🥈" : "🥉";
}

/* ─── Campaign frame ─────────────────────────────────────────────────────── */

function CampaignFrame({ campaign }: { campaign: WeeklyCampaign | null }) {
  const countdown = useWeekCountdown();
  const merchant = campaign?.merchant ?? null;
  const tiers = campaign?.tiers.slice(0, 3) ?? [];

  return (
    <section className="mx-4 mt-3 overflow-hidden rounded-2xl bg-[#062329] p-4 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {merchant?.imageUrl && (
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-white/10">
              <Image src={merchant.imageUrl} alt={merchant.name} fill className="object-cover" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#83E8F2]">Weekly Challenge</p>
            <p className="truncate text-base font-bold text-white">
              {merchant ? merchant.name : "This week's prizes"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
          <Timer size={11} weight="fill" className="text-[#83E8F2]" />
          <span className="text-[11px] font-bold tabular-nums text-white">{countdown}</span>
        </div>
      </div>

      {tiers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tiers.map((t) => (
            <span
              key={t.rank}
              className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/15"
            >
              {t.rank === 1 ? "🏆" : t.rank === 2 ? "🥈" : "🥉"} {t.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Delta nudge ─────────────────────────────────────────────────────────── */

function DeltaNudge({
  gameType,
  gameName,
  myRank,
  myScore,
  entries,
  rank3Label,
}: {
  gameType: GameType;
  gameName: string;
  myRank: number | null;
  myScore: number | null;
  entries: StandingEntry[];
  rank3Label: string | null;
}) {
  const nudge = computeDeltaNudge({ myRank, myScore, entries, rank3Label, gameName });

  useEffect(() => {
    posthog.capture("delta_nudge_impression", { situation: nudge.situation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge.situation]);

  if (nudge.situation === "not_played") {
    return (
      <Link
        href={GAME_META[gameType].route}
        onClick={() => posthog.capture("challenge_play_tap", { game: gameType })}
        className="mt-1 inline-block text-xs font-semibold text-[#238D9D]"
      >
        {nudge.copy} →
      </Link>
    );
  }

  return <p className="mt-1 text-xs font-semibold text-[#238D9D]">{nudge.copy}</p>;
}

/* ─── This week board ─────────────────────────────────────────────────────── */

function GameBoard({ gameType, campaign }: { gameType: GameType; campaign: WeeklyCampaign | null }) {
  const { address } = useWeb3();
  const { entries, myBest, isLoading } = useWeeklyLeaderboard(gameType);
  const meta = GAME_META[gameType];
  const Icon = meta.icon;
  const rank3Label = campaign?.tiers.find((t) => t.rank === 3)?.label ?? null;
  const myRank = myBest?.rank ?? null;

  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-2xl border border-[#F0F0F0] bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#F5F5F5] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF7F8] text-[#238D9D]">
          <Icon size={16} weight="duotone" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#0D2B30]">{meta.name}</h3>
          <p className="text-[11px] text-[#667579] font-poppins">Top 3 win vouchers</p>
        </div>
      </div>

      {/* Pinned row — always visible above the board if you played */}
      {myBest && (
        <div className="border-b border-[#F5F5F5] bg-[#F7FEFF]">
          <EntryRow
            entry={myBest}
            rank={myBest.rank}
            isYou
            prizeLabel={prizeChipLabel(myBest.rank, campaign)}
          />
          <div className="px-4 pb-3">
            <DeltaNudge
              gameType={gameType}
              gameName={meta.name}
              myRank={myRank}
              myScore={myBest.score}
              entries={entries}
              rank3Label={rank3Label}
            />
          </div>
        </div>
      )}
      {!myBest && !isLoading && (
        <div className="border-b border-[#F5F5F5] px-4 py-3">
          <DeltaNudge
            gameType={gameType}
            gameName={meta.name}
            myRank={null}
            myScore={null}
            entries={entries}
            rank3Label={rank3Label}
          />
        </div>
      )}

      {/* Board */}
      <div className="divide-y divide-[#F5F5F5]">
        {entries.slice(0, 10).map((entry) => (
          <div key={`${entry.rank}-${entry.walletAddress}`}>
            <EntryRow
              entry={entry}
              rank={entry.rank}
              isYou={!!address && entry.walletAddress.toLowerCase() === address.toLowerCase()}
              prizeLabel={prizeChipLabel(entry.rank, campaign)}
            />
            {entry.rank === 3 && entries.length > 3 && <PrizeZoneDivider />}
          </div>
        ))}

        {entries.length === 0 && !isLoading && (
          <div className="px-4 py-8 text-center">
            <p className="mb-3 text-sm text-[#817E7E] font-poppins">No entries yet — be first on the board</p>
            <Link
              href={meta.route}
              onClick={() => posthog.capture("challenge_play_tap", { game: gameType })}
              className="inline-flex items-center gap-1 rounded-xl bg-[#238D9D] px-4 py-2 text-sm font-bold text-white"
            >
              Play {meta.name}
            </Link>
          </div>
        )}
        {isLoading && (
          <div className="px-4 py-6 text-center text-xs text-[#817E7E]">Loading…</div>
        )}
      </div>
    </section>
  );
}

/* ─── Last week ───────────────────────────────────────────────────────────── */

type LastWeekWinner = {
  rank: number;
  walletAddress: string;
  username: string | null;
  score: number;
  prizeLabel: string | null;
};

type LastWeekStanding = EntryRowEntry & { rank: number };

type LastWeekGame = {
  gameType: GameType;
  winners: LastWeekWinner[];
  standings: LastWeekStanding[];
};

function useLastWeek() {
  const [data, setData] = useState<{ week: string; games: LastWeekGame[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/games/challenge/last-week")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ week: "", games: [] }); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, isLoading };
}

function LastWeekBoard({ game }: { game: LastWeekGame }) {
  const meta = GAME_META[game.gameType];
  const Icon = meta.icon;
  const winnerByRank = new Map(game.winners.map((w) => [w.rank, w]));

  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-2xl border border-[#F0F0F0] bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#F5F5F5] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF7F8] text-[#238D9D]">
          <Icon size={16} weight="duotone" />
        </div>
        <h3 className="text-sm font-bold text-[#0D2B30]">{meta.name}</h3>
      </div>

      <div className="divide-y divide-[#F5F5F5]">
        {game.standings.map((s) => {
          const winner = winnerByRank.get(s.rank);
          return (
            <div key={`${s.rank}-${s.walletAddress}`}>
              <EntryRow
                entry={s}
                rank={s.rank}
                isYou={false}
                prizeLabel={winner?.prizeLabel ? `Won ${winner.prizeLabel}` : undefined}
              />
              {s.rank === 3 && game.standings.length > 3 && <PrizeZoneDivider />}
            </div>
          );
        })}
        {game.standings.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-[#817E7E] font-poppins">
            No results recorded for last week.
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function WeeklyChallengePage() {
  const [tab, setTab] = useState<"this-week" | "last-week">("this-week");
  const { campaign } = useWeeklyCampaign();
  const { data: lastWeek, isLoading: lastWeekLoading } = useLastWeek();

  useEffect(() => {
    posthog.capture("challenge_page_view", { tab, has_campaign: !!campaign?.merchant });
  }, [tab, campaign?.merchant]);

  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-20 font-sterling">
      <div className="flex items-center gap-3 px-4 pt-4 pb-1">
        <Link href="/games" className="text-gray-500" aria-label="Back to games">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-xl font-bold text-[#0D2B30]">Weekly Challenge</h1>
      </div>

      <CampaignFrame campaign={campaign} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "this-week" | "last-week")} className="mt-4">
        <TabsList className="mx-4">
          <TabsTrigger value="this-week">This week</TabsTrigger>
          <TabsTrigger value="last-week">Last week</TabsTrigger>
        </TabsList>

        <TabsContent value="this-week" className="mx-0">
          {WEEKLY_GAME_TYPES.map((gameType) => (
            <GameBoard key={gameType} gameType={gameType} campaign={campaign} />
          ))}
        </TabsContent>

        <TabsContent value="last-week" className="mx-0">
          {lastWeek?.week && (
            <p className="mx-4 mt-3 text-sm font-semibold text-[#667579] font-poppins">
              Week {lastWeek.week} results
            </p>
          )}
          {lastWeekLoading && (
            <div className="mx-4 mt-4 text-center text-xs text-[#817E7E]">Loading…</div>
          )}
          {lastWeek?.games.map((game) => (
            <LastWeekBoard key={game.gameType} game={game} />
          ))}
        </TabsContent>
      </Tabs>
    </main>
  );
}
