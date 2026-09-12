"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import posthog from "posthog-js";
import { StreakInfoSheet } from "@/components/StreakDetailModal";
import { useWeb3 } from "@/contexts/useWeb3";
import { isMiniPayProvider } from "@/lib/minipay";

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

// Every quest below uses the self-claim voucher path
// (docs/all-quests-self-claim-spec.md) — everything else keeps its existing
// mint-job/queue behavior untouched.
const DAILY_CHECKIN_QUEST_ID = "a9c68150-7db8-4555-b87f-5e9117b43a08";
const CLAIM_STATUS_POLL_TIMEOUT_MS = 90_000;
const CLAIM_STATUS_POLL_INTERVALS_MS = [2000, 3000, 5000, 8000, 13000, 15000];

// Generic, family-agnostic confirm/status surface (all-quests-self-claim-spec.md
// §5.4) — every self-claim quest below uses these, including daily check-in;
// the daily-specific /api/quests/daily/confirm and /claim-status endpoints
// remain only as compatibility aliases for any client that never updates.
const SELF_CLAIM_CONFIRM_URL = "/api/quests/self-claim/confirm";
const SELF_CLAIM_STATUS_URL = "/api/quests/self-claim/status";
const SELF_CLAIM_PENDING_URL = "/api/quests/self-claim/pending";

function shortTxHash(hash: string) {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function walletProviderLabel(): "minipay" | "browser" {
  return isMiniPayProvider() ? "minipay" : "browser";
}

/**
 * Wallet-scoped localStorage collection of every in-flight self-claim, keyed
 * by intent id, so a browser close mid-poll can resume on the next page
 * load instead of relying solely on the user tapping the card again
 * (all-quests-self-claim-spec.md §9 — "Use one wallet-scoped collection
 * keyed by intent ID, not the current single daily localStorage record").
 * Server-side sweeping in the voucher route separately covers "next day,
 * next tap" recovery; this covers "closed mid-poll, reopened moments later".
 */
type PendingClaimRecord = { intentId: string; txHash: string; family: string; questId: string };
type PendingClaimStore = Record<string, PendingClaimRecord>; // keyed by intentId

function pendingClaimsKey(address: string) {
  return `akiba:self-claim:pending:${address.toLowerCase()}`;
}

function loadPendingClaims(address: string): PendingClaimStore {
  try {
    const raw = window.localStorage.getItem(pendingClaimsKey(address));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePendingClaim(address: string, record: PendingClaimRecord) {
  try {
    const store = loadPendingClaims(address);
    store[record.intentId] = record;
    window.localStorage.setItem(pendingClaimsKey(address), JSON.stringify(store));
  } catch {
    // Private browsing / storage disabled — resumption just won't happen; not fatal.
  }
}

function clearPendingClaim(address: string, intentId: string) {
  try {
    const store = loadPendingClaims(address);
    delete store[intentId];
    window.localStorage.setItem(pendingClaimsKey(address), JSON.stringify(store));
  } catch {
    // ignore
  }
}

const KILN_DAILY_HOLD_QUEST_ID =
  process.env.NEXT_PUBLIC_KILN_DAILY_HOLD_QUEST_ID ??
  "9ca81915-8707-43c9-9472-9faed0c7cc58";

/* ─── tiny wrappers ───────────────────────────────────────── */

async function claimSevenDayStreak(addr: string) {
  const res = await fetch("/api/quests/seven_day_streak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress: addr.toLowerCase(),
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
 * Every quest wired onto the self-claim voucher path
 * (docs/all-quests-self-claim-spec.md). `legacyClaim` is the existing
 * sponsored-path function called only when the wallet's family isn't in
 * self-claim mode yet (voucher route returns code "self-claim-disabled") —
 * exactly the same fallback behavior daily check-in already had.
 */
type SelfClaimQuestConfig = {
  family: string;
  voucherUrl: string;
  legacyClaim: (addr: string) => Promise<any>;
  // Only the balance-streak tiers need this — the voucher route selects
  // among a fixed server allowlist by questId (all-quests-self-claim-spec.md
  // §5.2); tier/minUsd/points are still resolved server-side, never trusted
  // from this body.
  voucherBody?: Record<string, unknown>;
};

const SELF_CLAIM_QUEST_CONFIG: Record<string, SelfClaimQuestConfig> = {
  [DAILY_CHECKIN_QUEST_ID]: {
    family: "daily_checkin",
    voucherUrl: "/api/quests/daily/voucher",
    legacyClaim: claimDailyQuest,
  },
  "383eaa90-75aa-4592-a783-ad9126e8f04d": {
    family: "daily_transfer",
    voucherUrl: "/api/quests/daily_transfer/voucher",
    legacyClaim: claimSendDollar,
  },
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16": {
    family: "daily_receive",
    voucherUrl: "/api/quests/daily_receive/voucher",
    legacyClaim: claimReceiveDollar,
  },
  "f6d027d2-bf52-4768-a87f-2be00a5b03a0": {
    family: "daily_5tx",
    voucherUrl: "/api/quests/daily_5_tx/voucher",
    legacyClaim: claimFiveTransfers,
  },
  "ea001296-2405-451b-a590-941af22a8df1": {
    family: "daily_10tx",
    voucherUrl: "/api/quests/daily_10_tx/voucher",
    legacyClaim: claimTenTransfers,
  },
  // Balance-streak tiers (Phase 3) — the voucher route picks the matching
  // tier adapter server-side from this questId (a fixed allowlist; tier,
  // minUsd and points are never trusted from the client either way).
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f": {
    family: "daily_balance_streak_10",
    voucherUrl: "/api/streaks/balances/voucher",
    voucherBody: { questId: "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f" },
    legacyClaim: claimBalanceStreak10,
  },
  "a1ac5914-20d4-4436-bf02-29563938fe9d": {
    family: "daily_balance_streak_30",
    voucherUrl: "/api/streaks/balances/voucher",
    voucherBody: { questId: "a1ac5914-20d4-4436-bf02-29563938fe9d" },
    legacyClaim: claimBalanceStreak30,
  },
  "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d": {
    family: "daily_balance_streak_100",
    voucherUrl: "/api/streaks/balances/voucher",
    voucherBody: { questId: "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d" },
    legacyClaim: claimBalanceStreak100,
  },
  // Seven-day send-streak reward (Phase 3) — instance-scoped; see
  // lib/server/adapters/sevenDaySendStreakAdapter.ts.
  "6ddc811a-1a4d-4e57-871d-836f07486531": {
    family: "seven_day_send_streak",
    voucherUrl: "/api/quests/seven_day_streak/voucher",
    legacyClaim: claimSevenDayStreak,
  },
};

if (KILN_DAILY_HOLD_QUEST_ID) {
  SELF_CLAIM_QUEST_CONFIG[KILN_DAILY_HOLD_QUEST_ID] = {
    family: "daily_kiln_hold",
    voucherUrl: "/api/quests/daily_kiln_hold/voucher",
    legacyClaim: claimKilnHold,
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

type MintStatus = "pending" | "processing" | "completed" | "failed";

function MintStatusPill({ status }: { status: MintStatus }) {
  // "failed" is treated as still processing — team reviews flagged wallets
  if (status === "pending" || status === "processing" || status === "failed") {
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-medium text-[#238D9D]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#238D9D] animate-pulse" />
        Minting…
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-green-600">
        ✓ Minted
      </span>
    );
  }
  return null;
}

export default function DailyChallenges({
  showCompleted = false,
}: {
  showCompleted?: boolean;
}) {
  const { address, getUserAddress, waitForAuth, claimQuestOnchain } = useWeb3();

  const [active, setActive] = useState<QuestRow[]>([]);
  const [completed, setCompleted] = useState<QuestRow[]>([]);
  const [loading, setLoading] = useState(true);

  // streak counts per questId
  const [streakCounts, setStreakCounts] = useState<Record<string, number>>({});

  // streak info sheet
  const [streakInfoOpen, setStreakInfoOpen] = useState(false);

  // mint job statuses for today's quests (questId → status)
  const [mintStatuses, setMintStatuses] = useState<Record<string, MintStatus>>({});
  // quests claimed this session that are still minting — kept in the active list so
  // the card stays visible with "Minting…" state instead of just disappearing
  const mintingInSessionRef = useRef<Set<string>>(new Set());

  // loading + result sheets
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimLoadingOpen, setClaimLoadingOpen] = useState(false);
  // dynamic loading-sheet copy for the daily self-claim flow's multiple stages
  const [claimLoadingMessage, setClaimLoadingMessage] = useState<string | null>(null);

  const [resultOpen, setResultOpen] = useState(false);
  const [resultVariant, setResultVariant] = useState<"success" | "already" | "error" | "pending">(
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

  /**
   * Resume every in-flight self-claim across a browser close/reopen, for
   * every quest at once (all-quests-self-claim-spec.md §9). Runs silently
   * (no loading/result sheet) — a claim broadcast in a previous page load
   * whose confirm/poll never got to finish otherwise has nothing else to
   * pick it back up until the user taps that card again.
   *
   * Two sources, both best-effort:
   *   1. This browser's own localStorage record of what it broadcast.
   *   2. The server's wallet-scoped /pending list, for cross-device recovery
   *      (a claim broadcast on another device/browser this one never heard of).
   * Cross-day recovery (closed overnight) is additionally handled server-side
   * — see sweepStaleClaimIntents in the voucher engine — since localStorage
   * only survives within the same browser/device.
   */
  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    (async () => {
      const localPending = loadPendingClaims(address);

      for (const record of Object.values(localPending)) {
        const outcome = await pollQuestClaimStatus(record.intentId, record.txHash);
        if (cancelled) return;
        if (outcome.status === "confirmed" || outcome.status === "issued" || outcome.status === "expired") {
          clearPendingClaim(address, record.intentId);
        }
        if (outcome.status === "confirmed") {
          window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
          window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));
        }
      }

      try {
        const res = await fetch(SELF_CLAIM_PENDING_URL).then((r) => r.json());
        if (cancelled || !res?.success) return;
        for (const intent of res.intents ?? []) {
          if (cancelled) return;
          if (localPending[intent.intentId]) continue; // already handled above
          const outcome = await pollQuestClaimStatus(intent.intentId, intent.txHash ?? undefined);
          if (cancelled) return;
          if (outcome.status === "confirmed") {
            window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
            window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));
          }
        }
      } catch {
        // best-effort cross-device recovery — silent
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

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

      // Keep quests that were just claimed this session in the active list so
      // the card stays visible with a "Minting…" indicator instead of vanishing
      const activeQs = supportedQuests.filter(
        (q) => !claimed.has(q.id) || mintingInSessionRef.current.has(q.id),
      );
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

      // Fetch mint job statuses — only when there's something to show
      // (avoids the extra round-trip on the home page before anything has been claimed)
      if (address && (showCompleted || mintingInSessionRef.current.size > 0)) {
        try {
          const mintRes = await fetch("/api/mint-jobs/pending");
          if (mintRes.ok) {
            const mintData = await mintRes.json();
            if (mintData.success && Array.isArray(mintData.jobs)) {
              const statusMap: Record<string, MintStatus> = {};
              for (const job of mintData.jobs) {
                statusMap[job.questId] = job.status;
              }
              setMintStatuses(statusMap);
            }
          }
        } catch {
          // non-critical — silent fail
        }
      }

      setLoading(false);
    }

    void fetchAll();

    const onRefresh = () => { void fetchAll(true); };
    window.addEventListener(QUESTS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(QUESTS_REFRESH_EVENT, onRefresh);
  }, [address]);

  // Poll mint statuses every 15 s while any job is still pending/processing/failed
  // (failed = under internal review, still shown as "Minting…" to the user)
  useEffect(() => {
    const needsPolling = Object.values(mintStatuses).some(
      (s) => s === "pending" || s === "processing" || s === "failed",
    );
    if (!needsPolling || !address) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/mint-jobs/pending");
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.jobs)) {
          const map: Record<string, MintStatus> = {};
          for (const job of data.jobs) {
            map[job.questId] = job.status;
          }
          setMintStatuses(map);

          // Remove quests that have finished minting from the session tracker
          // and trigger a refresh so they move cleanly to the Completed tab
          let anyFinished = false;
          for (const [questId, status] of Object.entries(map)) {
            if (status === "completed" && mintingInSessionRef.current.has(questId)) {
              mintingInSessionRef.current.delete(questId);
              anyFinished = true;
            }
          }
          if (anyFinished) {
            window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
          }
        }
      } catch {
        // silent
      }
    }, 15_000);

    return () => clearInterval(timer);
  }, [mintStatuses, address]);

  const quests = showCompleted ? completed : active;

  /** Polls the generic GET /api/quests/self-claim/status endpoint (works for
   *  any quest family) with bounded backoff until the intent confirms,
   *  resets to issued (reverted/invalid/dropped), or the UI timeout is
   *  reached. A timeout is reported as "pending", never "failed" — the
   *  reconciliation keeps running server-side regardless of this tab.
   *  `txHash`, when known, is resent on every tick as a reconciliation hint
   *  so a poll that lands before our own POST /confirm call has persisted
   *  the hash still self-heals instead of seeing the intent's pre-submission
   *  "issued" state and misreporting a still-pending transaction as failed. */
  async function pollQuestClaimStatus(intentId: string, txHash?: string): Promise<{
    status: "confirmed" | "issued" | "expired" | "timeout";
    points?: number;
    txHash?: string | null;
  }> {
    const query = new URLSearchParams({ intentId });
    if (txHash) query.set("txHash", txHash);

    let elapsed = 0;
    let idx = 0;
    while (elapsed < CLAIM_STATUS_POLL_TIMEOUT_MS) {
      const res = await fetch(`${SELF_CLAIM_STATUS_URL}?${query.toString()}`)
        .then((r) => r.json())
        .catch(() => null);

      if (res?.success && res.status === "confirmed") {
        return { status: "confirmed", points: res.points, txHash: res.txHash };
      }
      if (res?.success && res.status === "issued") {
        return { status: "issued" };
      }
      if (res?.success && res.status === "expired") {
        return { status: "expired" };
      }

      const wait = CLAIM_STATUS_POLL_INTERVALS_MS[
        Math.min(idx, CLAIM_STATUS_POLL_INTERVALS_MS.length - 1)
      ];
      await new Promise((resolve) => setTimeout(resolve, wait));
      elapsed += wait;
      idx++;
    }
    return { status: "timeout" };
  }

  /** Generic self-claim flow (docs/all-quests-self-claim-spec.md §9) — used
   *  by every quest in SELF_CLAIM_QUEST_CONFIG, including daily check-in.
   *  Every other quest keeps using the generic queued path below. */
  async function runQuestSelfClaim(q: QuestRow, config: SelfClaimQuestConfig) {
    const providerLabel = walletProviderLabel();
    const analyticsBase = { family: config.family, quest_id: q.id };

    try {
      setClaimLoadingMessage("Checking your reward…");
      const voucherRes: any = await fetch(config.voucherUrl, {
        method: "POST",
        ...(config.voucherBody
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(config.voucherBody) }
          : {}),
      })
        .then((r) => r.json())
        .catch(() => null);

      if (!voucherRes?.success) {
        if (voucherRes?.code === "self-claim-disabled") {
          // Self-claim isn't rolled out to this wallet — fall back to the
          // existing sponsored queue path, unchanged.
          const legacy: any = await config.legacyClaim(address!);
          if (legacy?.success) {
            if (legacy.queued) mintingInSessionRef.current.add(q.id);
            window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
            window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));
            setResultVariant("success");
            setResultTitle("Claim Successful!");
            setResultMessage(
              legacy.queued
                ? `Your ${legacy.points ?? q.reward_points} AkibaMiles are being minted — this usually takes a few minutes. No need to tap again!`
                : `You claimed ${legacy.points ?? q.reward_points} AkibaMiles.`
            );
          } else if (legacy?.code === "already") {
            setResultVariant("already");
            setResultTitle("Already claimed");
            setResultMessage(legacy.message || "You’ve already claimed this reward.");
          } else {
            setResultVariant("error");
            setResultTitle("Claim failed");
            setResultMessage(legacy?.message || "Network or contract error");
          }
          return;
        }

        if (voucherRes?.code === "already") {
          setResultVariant("already");
          setResultTitle("Already claimed");
          setResultMessage("You’ve already claimed this reward.");
          return;
        }

        if (voucherRes?.code === "submitted") {
          // A previous attempt from this wallet is still confirming — resume
          // polling instead of asking the wallet to sign anything new.
          posthog.capture("quest_self_claim_retried", { ...analyticsBase, previous_status: "submitted" });
          setClaimLoadingMessage("Confirming on Celo…");
          if (voucherRes.intentId && voucherRes.txHash) {
            savePendingClaim(address!, {
              intentId: voucherRes.intentId,
              txHash: voucherRes.txHash,
              family: config.family,
              questId: q.id,
            });
          }
          const outcome = await pollQuestClaimStatus(voucherRes.intentId, voucherRes.txHash);
          applyQuestClaimOutcome(outcome, q, voucherRes.intentId);
          return;
        }

        setResultVariant("error");
        setResultTitle("Claim failed");
        setResultMessage(voucherRes?.message || "Could not prepare your claim. Please try again.");
        return;
      }

      posthog.capture("quest_self_claim_voucher_issued", {
        ...analyticsBase,
        scope_key: voucherRes.scopeKey,
        points: voucherRes.points,
        boosted: !!voucherRes.vaultBoost?.applied,
        wallet_provider: providerLabel,
      });

      setClaimLoadingMessage("Confirm the transaction in your wallet. You pay the network fee.");
      posthog.capture("quest_self_claim_wallet_opened", { ...analyticsBase, wallet_provider: providerLabel });

      const broadcastStartedAt = Date.now();
      let txHash: `0x${string}`;
      try {
        txHash = await claimQuestOnchain({
          contractAddress: voucherRes.contractAddress,
          amount: voucherRes.amount,
          dayNonce: voucherRes.dayNonce,
          deadline: voucherRes.deadline,
          signature: voucherRes.signature,
        });
      } catch (err: any) {
        posthog.capture("quest_self_claim_failed", {
          ...analyticsBase,
          stage: "wallet",
          reason: err?.message ?? "unknown",
          wallet_provider: providerLabel,
        });
        setResultVariant("error");
        setResultTitle("Claim failed");
        setResultMessage(err?.message || "Could not submit the claim. Please try again.");
        return;
      }

      posthog.capture("quest_self_claim_submitted", { ...analyticsBase, tx_hash: txHash, wallet_provider: providerLabel });
      setClaimLoadingMessage(`Confirming on Celo… (${shortTxHash(txHash)})`);
      // Persisted so a browser close mid-poll can resume on the next page
      // load instead of being lost with this component's in-memory state.
      savePendingClaim(address!, { intentId: voucherRes.intentId, txHash, family: config.family, questId: q.id });

      // Fire-and-forget: the confirm route records the hash and attempts
      // reconciliation immediately. Polling below is the source of truth —
      // and resends txHash on every tick as its own reconciliation hint, so
      // it self-heals even if this particular request never lands.
      fetch(SELF_CLAIM_CONFIRM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, intentId: voucherRes.intentId }),
      }).catch(() => undefined);

      const outcome = await pollQuestClaimStatus(voucherRes.intentId, txHash);
      if (outcome.status === "confirmed") {
        posthog.capture("quest_self_claim_confirmed", {
          ...analyticsBase,
          points: outcome.points ?? voucherRes.points,
          boosted: !!voucherRes.vaultBoost?.applied,
          confirmation_ms: Date.now() - broadcastStartedAt,
        });
      }
      applyQuestClaimOutcome(outcome, q, voucherRes.intentId, voucherRes.points);
    } catch (e: any) {
      console.error(e);
      posthog.capture("quest_self_claim_failed", {
        ...analyticsBase,
        stage: "unknown",
        reason: e?.message ?? "unknown",
        wallet_provider: providerLabel,
      });
      setResultVariant("error");
      setResultTitle("Claim failed");
      setResultMessage("Network or contract error");
    }
  }

  function applyQuestClaimOutcome(
    outcome: { status: "confirmed" | "issued" | "expired" | "timeout"; points?: number; txHash?: string | null },
    q: QuestRow,
    intentId: string,
    fallbackPoints?: number,
  ) {
    // Only clear the persisted pending-claim record on a terminal outcome —
    // a "timeout" here just means the UI gave up waiting, not that
    // reconciliation stopped, so resume-on-mount must still pick it up later.
    if (outcome.status === "confirmed" || outcome.status === "issued" || outcome.status === "expired") {
      if (address) clearPendingClaim(address, intentId);
    }

    if (outcome.status === "confirmed") {
      window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
      window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));
      setResultVariant("success");
      setResultTitle("Claim Successful!");
      setResultMessage(`You claimed ${outcome.points ?? fallbackPoints ?? q.reward_points} AkibaMiles.`);
      return;
    }
    if (outcome.status === "issued") {
      setResultVariant("error");
      setResultTitle("Claim failed");
      setResultMessage("Transaction failed. You can try again today.");
      return;
    }
    if (outcome.status === "expired") {
      setResultVariant("error");
      setResultTitle("Claim expired");
      setResultMessage("That claim expired before it confirmed. Request today's reward and try again.");
      return;
    }
    setResultVariant("pending");
    setResultTitle("Still confirming");
    setResultMessage(
      "We’re still confirming your transaction on Celo. Tap this card again in a moment to check its status — no need to submit again.",
    );
  }

  async function runQuest(q: QuestRow) {
    if (showCompleted) return;
    if (!address) return;
    if (claimBusy) return;
    await waitForAuth();

    const selfClaimConfig = SELF_CLAIM_QUEST_CONFIG[q.id];
    if (selfClaimConfig) {
      setClaimBusy(true);
      setLastQuestTitle(q.title);
      setClaimLoadingMessage(null);
      setClaimLoadingOpen(true);
      try {
        await runQuestSelfClaim(q, selfClaimConfig);
      } finally {
        setClaimLoadingOpen(false);
        setResultOpen(true);
        setClaimBusy(false);
      }
      return;
    }

    const map = ACTION_BY_ID[q.id];
    if (!map) return;

    setClaimBusy(true);
    setLastQuestTitle(q.title);
    setClaimLoadingOpen(true);

    try {
      const res: any = await map.action(address);

      if (res?.success) {
        if (res.queued) {
          // Keep the card visible in the active list with "Minting…" state
          mintingInSessionRef.current.add(q.id);
        }
        // Refetch so the active list re-renders (card stays due to ref above)
        window.dispatchEvent(new Event(QUESTS_REFRESH_EVENT));
        window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));

        setResultVariant("success");
        setResultTitle("Claim Successful!");
        setResultMessage(
          res.queued
            ? `Your ${res.points ?? q.reward_points} AkibaMiles are being minted — this usually takes a few minutes. No need to tap again!`
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

            const isMinting = !showCompleted && mintingInSessionRef.current.has(q.id);

            return (
              <button
                key={q.id}
                disabled={showCompleted || claimBusy || isMinting}
                onClick={() => runQuest(q)}
                className={`relative h-60 w-44 flex-none rounded-xl p-4 shadow-xl ${
                  showCompleted
                    ? "cursor-default bg-blue-50 opacity-70"
                    : isMinting
                    ? "cursor-default border border-[#238D9D4D] bg-white opacity-70"
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
                  {isMinting && <MintStatusPill status="pending" />}
                  {showCompleted && mintStatuses[q.id] && (
                    <MintStatusPill status={mintStatuses[q.id]} />
                  )}
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
          claimLoadingMessage
            ? claimLoadingMessage
            : lastQuestTitle
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
