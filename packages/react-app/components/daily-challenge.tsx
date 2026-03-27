"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import { StreakInfoSheet } from "@/components/StreakDetailModal";
import { useWeb3 } from "@/contexts/useWeb3";

import {
  QuestClaimLoadingSheet,
  QuestClaimResultSheet,
} from "@/components/QuestClaimSheet";

import {
  claimBalanceStreak10,
  claimBalanceStreak30,
  claimBalanceStreak100,
} from "@/helpers/claimBalanceStreak";
import { claimDailyQuest } from "@/helpers/claimDaily";
import { claimFiveTransfers } from "@/helpers/claimFiveTransfers";
import { claimKilnHold } from "@/helpers/claimKilnHold";
import { claimTenTransfers } from "@/helpers/claimTenTransfers";
// import { claimTopupStreak } from "@/helpers/claimWeeklyTopup";

import { Cash, Door, akibaMilesSymbol } from "@/lib/svg";
import streakIcon from "@/public/svg/streak.svg";

/* ─── Supabase ───────────────────────────────────────────── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const TOPUP_STREAK_QUEST_ID = "96009afb-0762-4399-adb3-ced421d73072";
const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";
const QUESTS_REFRESH_EVENT = "akiba:quests:refresh";

const KILN_DAILY_HOLD_QUEST_ID =
  process.env.NEXT_PUBLIC_KILN_DAILY_HOLD_QUEST_ID ??
  "9ca81915-8707-43c9-9472-9faed0c7cc58";

/* ─── tiny wrappers ───────────────────────────────────────── */

async function claimSevenDayStreak(addr: string) {
  const res = await fetch("/api/quests/seven_day_streak", {
    method: "POST",
    body: JSON.stringify({
      userAddress: addr,
      questId: "6ddc811a-1a4d-4e57-871d-836f07486531",
    }),
  }).then((r) => r.json());
  return res;
}

async function claimSendDollar(addr: string) {
  const res = await fetch("/api/quests/daily_transfer", {
    method: "POST",
    body: JSON.stringify({
      userAddress: addr,
      questId: "383eaa90-75aa-4592-a783-ad9126e8f04d",
    }),
  }).then((r) => r.json());
  return res;
}

async function claimReceiveDollar(addr: string) {
  const res = await fetch("/api/quests/daily_receive", {
    method: "POST",
    body: JSON.stringify({
      userAddress: addr,
      questId: "c6b14ae1-66e9-4777-9c9f-65e57b091b16",
    }),
  }).then((r) => r.json());
  return res;
}

/* ─── quest row type ─────────────────────────────────────── */
type QuestRow = {
  id: string;
  title: string;
  description: string;
  reward_points: number;
  is_active: boolean;
};

/** streaks table row */
type StreakRow = {
  quest_id: string;
  current_streak: number;
};

type QuestHandler = {
  action: (addr: string) => Promise<any>;
  img: any;
};

const ACTION_BY_ID: Record<string, QuestHandler> = {
  /* A. Daily login / check-in */
  "a9c68150-7db8-4555-b87f-5e9117b43a08": {
    action: claimDailyQuest,
    img: Door,
  },

  /* B. Daily send ≥ $1 */
  "383eaa90-75aa-4592-a783-ad9126e8f04d": {
    action: claimSendDollar,
    img: Cash,
  },

  /* C. Daily receive ≥ $1 */
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16": {
    action: claimReceiveDollar,
    img: Cash,
  },

  // /* G. Weekly $5 top-up streak */
  // "96009afb-0762-4399-adb3-ced421d73072": {
  //   action: claimTopupStreak,
  //   img: Cash,
  // },

  /* H. 7-day daily-quest streak */
  "6ddc811a-1a4d-4e57-871d-836f07486531": {
    action: claimSevenDayStreak,
    img: Cash,
  },

  /* I. Wallet balance streak ≥ $10 */
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f": {
    action: claimBalanceStreak10,
    img: Cash,
  },

  /* J. Wallet balance streak ≥ $30 */
  "a1ac5914-20d4-4436-bf02-29563938fe9d": {
    action: claimBalanceStreak30,
    img: Cash,
  },

  /* K. Wallet balance streak ≥ $100 */
  "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d": {
    action: claimBalanceStreak100,
    img: Cash,
  },

  /* D. Send 5 transfers */
  "f6d027d2-bf52-4768-a87f-2be00a5b03a0": {
    action: claimFiveTransfers,
    img: Cash,
  },

  /* E. Send 10 transfers */
  "ea001296-2405-451b-a590-941af22a8df1": {
    action: claimTenTransfers,
    img: Cash,
  },

};

if (KILN_DAILY_HOLD_QUEST_ID) {
  ACTION_BY_ID[KILN_DAILY_HOLD_QUEST_ID] = {
    action: claimKilnHold,
    img: Cash,
  };
}

/**
 * Which quests show the streak flame badge.
 * Note: Kiln is NOT included here unless you also track it in the `streaks` table.
 */
const STREAK_QUEST_IDS = new Set<string>([
  "6ddc811a-1a4d-4e57-871d-836f07486531",
  "96009afb-0762-4399-adb3-ced421d73072",
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f",
  "a1ac5914-20d4-4436-bf02-29563938fe9d",
  "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d",
]);

/* Desired visual order */
const ORDERED_IDS = [
  "a9c68150-7db8-4555-b87f-5e9117b43a08",
  "383eaa90-75aa-4592-a783-ad9126e8f04d",
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16",
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f",
  "a1ac5914-20d4-4436-bf02-29563938fe9d",
  "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d",
  "96009afb-0762-4399-adb3-ced421d73072",
  ...(KILN_DAILY_HOLD_QUEST_ID ? [KILN_DAILY_HOLD_QUEST_ID] : []),
  "6ddc811a-1a4d-4e57-871d-836f07486531",
  "f6d027d2-bf52-4768-a87f-2be00a5b03a0",
  "ea001296-2405-451b-a590-941af22a8df1",
];

function sortByDesiredOrder(rows: QuestRow[]) {
  const pos = new Map(ORDERED_IDS.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => {
    const ai = pos.has(a.id)
      ? (pos.get(a.id) as number)
      : Number.POSITIVE_INFINITY;
    const bi = pos.has(b.id)
      ? (pos.get(b.id) as number)
      : Number.POSITIVE_INFINITY;

    if (ai !== bi) return ai - bi;
    if (b.reward_points !== a.reward_points) return b.reward_points - a.reward_points;
    return a.title.localeCompare(b.title);
  });
}

export default function DailyChallenges({
  showCompleted = false,
}: {
  showCompleted?: boolean;
}) {
  const { address, getUserAddress, waitForAuth } = useWeb3();

  const [active, setActive] = useState<QuestRow[]>([]);
  const [completed, setCompleted] = useState<QuestRow[]>([]);
  const [loading, setLoading] = useState(true);

  // streak counts per questId
  const [streakCounts, setStreakCounts] = useState<Record<string, number>>({});

  // streak info sheet
  const [streakInfoOpen, setStreakInfoOpen] = useState(false);

  // loading + result sheets
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimLoadingOpen, setClaimLoadingOpen] = useState(false);

  const [resultOpen, setResultOpen] = useState(false);
  const [resultVariant, setResultVariant] = useState<"success" | "already" | "error">(
    "success",
  );
  const [resultTitle, setResultTitle] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  // for nicer messaging
  const [lastQuestTitle, setLastQuestTitle] = useState<string>("");

  /* wallet */
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  /* fetch quests + streaks — also re-runs on QUESTS_REFRESH_EVENT */
  useEffect(() => {
    async function fetchAll(silent = false) {
      if (!silent) setLoading(true);

      const { data: quests } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true);

      if (!quests) {
        setLoading(false);
        return;
      }

      const typedQuests = quests as QuestRow[];
      const supportedQuests = typedQuests.filter((q) => ACTION_BY_ID[q.id]);

      if (!address) {
        setActive(sortByDesiredOrder(supportedQuests));
        setCompleted([]);
        setStreakCounts({});
        setLoading(false);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);

      const { data: eng } = await supabase
        .from("daily_engagements")
        .select("quest_id")
        .eq("user_address", address.toLowerCase())
        .eq("claimed_at", today);

      const claimed = new Set(eng?.map((e) => e.quest_id));

      const activeQs = supportedQuests.filter((q) => !claimed.has(q.id));
      const completedQs = supportedQuests.filter((q) => claimed.has(q.id));

      setActive(sortByDesiredOrder(activeQs));
      setCompleted(sortByDesiredOrder(completedQs));

      const userLc = address.toLowerCase();

      try {
        const { data: streakRows, error: streakErr } = await supabase
          .from("streaks")
          .select("quest_id, scope, current_streak, last_scope_key")
          .eq("user_address", userLc);

        if (streakErr) {
          console.error("[daily-challenge] streaks fetch error:", streakErr);
        } else if (streakRows) {
          const todayKey = new Date().toISOString().slice(0, 10);
          const currentWeekKey = (() => {
            const now = new Date();
            const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
            const dayNum = tmp.getUTCDay() || 7;
            tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
            const weekNo = Math.ceil(
              ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
            );
            return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
          })();

          const map: Record<string, number> = {};
          (streakRows as (StreakRow & {
            scope?: "daily" | "weekly" | null;
            last_scope_key?: string | null;
          })[]).forEach((row) => {
            if (STREAK_QUEST_IDS.has(row.quest_id)) {
              const lastScopeKey = row.last_scope_key ?? null;
              const isWeekly =
                row.scope === "weekly" || row.quest_id === TOPUP_STREAK_QUEST_ID;
              const isCurrent =
                (isWeekly && lastScopeKey === currentWeekKey) ||
                (!isWeekly && lastScopeKey === todayKey);

              map[row.quest_id] = isCurrent ? row.current_streak : 0;
            }
          });
          setStreakCounts(map);
        }
      } catch (err) {
        console.error("[daily-challenge] streaks fetch threw:", err);
      }

      setLoading(false);
    }

    void fetchAll();

    const onRefresh = () => { void fetchAll(true); };
    window.addEventListener(QUESTS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(QUESTS_REFRESH_EVENT, onRefresh);
  }, [address]);

  const quests = showCompleted ? completed : active;

  async function runQuest(q: QuestRow) {
    if (showCompleted) return;
    if (!address) return;
    if (claimBusy) return;
    await waitForAuth();

    const map = ACTION_BY_ID[q.id];
    if (!map) return;

    setClaimBusy(true);
    setLastQuestTitle(q.title);
    setClaimLoadingOpen(true);

    try {
      const res: any = await map.action(address);

      if (res?.success) {
        // Refetch all DailyChallenges instances (active + completed tabs) from DB
        window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
        window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));

        setResultVariant("success");
        setResultTitle("Claim Successful!");
        setResultMessage(
          res.queued
            ? `Your ${res.points ?? q.reward_points} AkibaMiles are on their way — they'll arrive in your wallet within a few minutes.`
            : `You claimed ${res.points ?? q.reward_points} AkibaMiles.`
        );
      } else if (res?.code === "already") {
        setResultVariant("already");
        setResultTitle("Already claimed");

        if (q.id === TOPUP_STREAK_QUEST_ID && res.nextClaimDate) {
          setResultMessage(
            `You’ve already claimed your top-up streak for this week.\n\nNext claim date: ${res.nextClaimDate}`,
          );
        } else {
          setResultMessage(res.message || "You’ve already claimed this reward.");
        }
      } else if (
        res?.code === "condition-failed" &&
        typeof res.missingUsd === "number"
      ) {
        const current =
          typeof res.currentUsd === "number"
            ? res.currentUsd.toFixed(2)
            : typeof res.totalUsd === "number"
            ? res.totalUsd.toFixed(2)
            : undefined;

        const missing = res.missingUsd.toFixed(2);

        setResultVariant("error");
        setResultTitle("Not eligible yet");

        if (q.id === TOPUP_STREAK_QUEST_ID) {
          setResultMessage(
            `You need $${missing} more in MiniPay top-ups this week to complete this streak.` +
              (current ? `\n\nCurrent top-ups this week: $${current}.` : ""),
          );
        } else {
          setResultMessage(
            res.message ||
              (current
                ? `You currently have $${current}. Top up $${missing} more to qualify.`
                : `Top up $${missing} more to qualify.`),
          );
        }
      } else {
        setResultVariant("error");
        setResultTitle("Claim failed");
        setResultMessage(res?.message || "Network or contract error");
      }
    } catch (e) {
      console.error(e);
      setResultVariant("error");
      setResultTitle("Claim failed");
      setResultMessage("Network or contract error");
    } finally {
      setClaimLoadingOpen(false);
      setResultOpen(true);
      setClaimBusy(false);
    }
  }

  if (loading) return null;

  return (
    <>
      {quests.length === 0 && (
        <p className="my-4 text-sm text-gray-500">
          {showCompleted
            ? "You haven’t completed any challenges today."
            : "No more challenges today — come back tomorrow!"}
        </p>
      )}

      {quests.length > 0 && (
        <div className="mt-4 flex space-x-3 overflow-x-auto">
          {quests.map((q) => {
            const map = ACTION_BY_ID[q.id];
            if (!map) return null;

            const isStreak = STREAK_QUEST_IDS.has(q.id);
            const streakCount = streakCounts[q.id] ?? 0;
            const showNumber = streakCount > 0;

            return (
              <button
                key={q.id}
                disabled={showCompleted || claimBusy}
                onClick={() => runQuest(q)}
                className={`relative h-60 w-44 flex-none rounded-xl p-4 shadow-xl ${
                  showCompleted
                    ? "cursor-default bg-blue-50 opacity-70"
                    : claimBusy
                    ? "cursor-not-allowed border border-[#238D9D4D] bg-white opacity-70"
                    : "border border-[#238D9D4D] bg-white"
                }`}
              >
                {isStreak && (
                  <div
                    className="absolute right-2 top-2 flex h-7 cursor-pointer items-center rounded-full bg-[#238D9D] px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStreakInfoOpen(true);
                    }}
                  >
                    {showNumber && (
                      <span className="mr-1 text-[11px] font-semibold leading-none text-white">
                        {streakCount}
                      </span>
                    )}
                    <Image src={streakIcon} alt="Streak" className="h-5 w-5" />
                  </div>
                )}

                <div className="flex h-full flex-col items-center justify-between text-center">
                  <Image src={map.img} alt="" className="mx-auto" />
                  <p className="mt-2 text-sm font-medium">{q.title}</p>
                  <p className="mt-1 break-words px-1 font-poppins text-xs leading-4 text-gray-600">
                    {q.description}
                  </p>
                  <p className="mt-2 flex items-center text-xs">
                    <Image src={akibaMilesSymbol} alt="" className="mr-1" />
                    {q.reward_points} AkibaMiles
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <StreakInfoSheet open={streakInfoOpen} onOpenChange={setStreakInfoOpen} />

      <QuestClaimLoadingSheet
        open={claimLoadingOpen}
        onOpenChange={setClaimLoadingOpen}
        title="Claiming reward"
        message={
          lastQuestTitle
            ? `Claiming “${lastQuestTitle}”… This usually takes a few seconds.`
            : "Processing your claim… This usually takes a few seconds."
        }
      />

      <QuestClaimResultSheet
        open={resultOpen}
        onOpenChange={setResultOpen}
        variant={resultVariant}
        title={resultTitle}
        message={resultMessage}
      />
    </>
  );
}
