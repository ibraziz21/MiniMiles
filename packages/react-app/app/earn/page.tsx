// src/app/earn/page.tsx
"use client";

import Image from "next/image";
import MiniPointsCard from "@/components/mini-points-card";
import DailyChallenges from "@/components/daily-challenge";
import PartnerQuests from "@/components/partner-quests";
import EarnPartnerQuestSheet from "@/components/earn-partner-quest-sheet";
import SuccessModal from "@/components/success-modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWeb3 } from "@/contexts/useWeb3";
import React, { useEffect, useState } from "react";
import { BadgesSection } from "@/components/BadgesSection";
import { RefreshSvg } from "@/lib/svg";
import dynamic from "next/dynamic";

// Passport helper
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";

// Badge metadata only
import {
  BADGES,
  type BadgeProgress,
  type BadgeKey,
  EMPTY_BADGE_PROGRESS,
} from "@/lib/prosperityBadges";

/* ──────────────────────────────────────────────────────────────── */
/*  Badge backend types                                            */
/* ──────────────────────────────────────────────────────────────── */

type TierMetadata = {
  badgeId: number;
  level: number;
  minValue: number;
  points: number;
};

type BackendBadgeTier = {
  points: string;
  tier: string;
  uri: string;
  metadata: TierMetadata;
};

type BackendBadge = {
  badgeId: string;
  badgeTiers: BackendBadgeTier[];
  uri: string;
  metadata: {
    name: string;
    description: string;
    platform: string;
    chains: string[];
    condition: string;
    image: string;
    "stack-image": string;
    season: number | null;
  };
  points: number;
  tier: number;
  claimableTier: number | null;
  claimable: boolean;
};

type BackendBadgesResponse = {
  currentBadges: BackendBadge[];
};

type PassportState =
  | { status: "idle" | "loading" | "none" }
  | { status: "has"; safe: `0x${string}` };

/* Map local keys → Prosperity badge IDs */
const BADGE_ID_BY_KEY: Record<BadgeKey, number | null> = {
  "cel2-transactions": 18,
  "s1-transactions": 22,
  "lam-lifetime-akiba": 27,
  "amg-akiba-games": 30, // not wired yet
};

function deriveProgressFromBackendBadge(badge: BackendBadge): number {
  const rawTier =
    typeof badge.tier === "number" && !Number.isNaN(badge.tier) ? badge.tier : 0;

  const maxSteps =
    Array.isArray(badge.badgeTiers) && badge.badgeTiers.length > 0
      ? badge.badgeTiers.length
      : 5;

  return Math.max(0, Math.min(rawTier, maxSteps));
}

function cacheKeyForSafe(safe: `0x${string}`) {
  return `akiba:badges:${safe.toLowerCase()}`;
}

function readBadgeCache(safe: `0x${string}`): {
  badgeProgress?: BadgeProgress;
  hasClaimableBadges?: boolean;
} | null {
  try {
    const raw = localStorage.getItem(cacheKeyForSafe(safe));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBadgeCache(
  safe: `0x${string}`,
  payload: { badgeProgress: BadgeProgress; hasClaimableBadges: boolean }
) {
  try {
    localStorage.setItem(cacheKeyForSafe(safe), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const BadgeClaimSuccessSheet = dynamic(
  () =>
    import("@/components/BadgeClaimSuccessSheet").then(
      (m) => m.BadgeClaimSuccessSheet
    ),
  { ssr: false }
);

const BadgeClaimLoadingSheet = dynamic(
  () =>
    import("@/components/BadgeClaimSuccessSheet").then(
      (m) => m.BadgeClaimLoadingSheet
    ),
  { ssr: false }
);

export default function EarnPage() {
  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [balance, setBalance] = useState("0");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quest, setQuest] = useState<any>(null);
  const [success, setSuccess] = useState(false);

  // Badges UI state
  const [passport, setPassport] = useState<PassportState>({ status: "idle" });
  const hasPassport = passport.status === "has";

  const [isRefreshingBadges, setIsRefreshingBadges] = useState(false);
  const [unlockedBadges, setUnlockedBadges] = useState<string[]>([]);
  const [badgeSheetOpen, setBadgeSheetOpen] = useState(false);
  const [badgeProgress, setBadgeProgress] = useState<BadgeProgress>(
    EMPTY_BADGE_PROGRESS
  );
  const [hasClaimableBadges, setHasClaimableBadges] = useState(false);
  const [badgeClaimLoadingOpen, setBadgeClaimLoadingOpen] = useState(false);
  const [badgeAction, setBadgeAction] = useState<
  "idle" | "checking" | "claiming"
>("idle");

const badgeBusy = badgeAction !== "idle";


  /* wallet + balance */
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const b = await getakibaMilesBalance();
        setBalance(b);
      } catch {
        // swallow
      }
    })();
  }, [address, getakibaMilesBalance]);

  /* ──────────────────────────────────────────────────────────────── */
  /*  Badges: fast perceived load                                   */
  /* ──────────────────────────────────────────────────────────────── */

  const refreshBadgesForSafe = async (safe: `0x${string}`) => {
    const cached = readBadgeCache(safe);
    if (cached?.badgeProgress) setBadgeProgress(cached.badgeProgress);
    if (typeof cached?.hasClaimableBadges === "boolean") {
      setHasClaimableBadges(cached.hasClaimableBadges);
    }

    const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
    const url = `${base}/api/user/${safe}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) return;

    const data: BackendBadgesResponse = await res.json();
    const backendBadges = data.currentBadges ?? [];

    const latest: BadgeProgress = { ...EMPTY_BADGE_PROGRESS };

    (Object.keys(latest) as BadgeKey[]).forEach((key) => {
      const badgeId = BADGE_ID_BY_KEY[key];
      if (badgeId == null) return;

      const backendBadge = backendBadges.find(
        (b) => Number(b.badgeId) === badgeId
      );
      if (!backendBadge) return;

      latest[key] = deriveProgressFromBackendBadge(backendBadge);
    });

    const trackedIds = new Set(
      Object.values(BADGE_ID_BY_KEY).filter((id): id is number => id != null)
    );

    const claimableExists = backendBadges.some((b) => {
      const idNum = Number(b.badgeId);
      const claimableTier = b.claimableTier ?? 0;
      const currentTier = b.tier ?? 0;
      return (
        trackedIds.has(idNum) &&
        b.claimable === true &&
        claimableTier > currentTier
      );
    });

    setBadgeProgress(latest);
    setHasClaimableBadges(claimableExists);

    writeBadgeCache(safe, {
      badgeProgress: latest,
      hasClaimableBadges: claimableExists,
    });
  };

  // passport + safe pipeline (single lookup)
  useEffect(() => {
    if (!address) {
      setPassport({ status: "none" });
      setBadgeProgress(EMPTY_BADGE_PROGRESS);
      setHasClaimableBadges(false);
      return;
    }

    let cancelled = false;
    setPassport({ status: "loading" });

    (async () => {
      try {
        const result: any = await fetchSuperAccountForOwner(address);
        if (cancelled) return;

        const safe =
          result?.hasPassport && result?.account?.smartAccount
            ? (result.account.smartAccount as `0x${string}`)
            : null;

        if (!safe) {
          setPassport({ status: "none" });
          return;
        }

        setPassport({ status: "has", safe });
        void refreshBadgesForSafe(safe);
      } catch {
        if (!cancelled) setPassport({ status: "none" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  async function claimProsperityBadgesForSafe(
    safe: `0x${string}`
  ): Promise<string[]> {
    try {
      const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
      const url = `${base}/api/user/${safe}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // non-JSON / empty body
      }

      if (!res.ok) return [];

      const msg =
        typeof data?.message === "string" ? data.message.toLowerCase() : "";
      if (msg === "error" || msg === "unauthorized") return [];

      const updates: any[] = Array.isArray(data?.badgeUpdates)
        ? data.badgeUpdates
        : [];

      const newlyUnlocked: string[] = [];

      updates.forEach((u) => {
        const idNum = Number(u.badgeId);
        const newLevel = Number(u.level ?? 0);
        const prevLevel = Number(u.previousLevel ?? 0);

        if (!Number.isFinite(idNum) || !Number.isFinite(newLevel)) return;

        const key = (Object.keys(BADGE_ID_BY_KEY) as BadgeKey[]).find(
          (k) => BADGE_ID_BY_KEY[k] === idNum
        );
        if (!key) return;

        const def = BADGES.find((bd) => bd.key === key);
        if (!def) return;

        for (let lvl = prevLevel + 1; lvl <= newLevel && lvl <= def.tiers.length; lvl++) {
          const tierDef = def.tiers[lvl - 1];
          newlyUnlocked.push(`${def.title} • ${tierDef.label}`);
        }
      });

      return newlyUnlocked;
    } catch {
      return [];
    }
  }

  const openQuest = (q: any) => {
    setQuest(q);
    setSheetOpen(true);
  };

  const badgeButtonLabel =
  badgeAction === "checking"
    ? "Checking…"
    : badgeAction === "claiming"
    ? "Claiming…"
    : hasClaimableBadges
    ? "Claim Badges"
    : "Refresh Badges";

  return (
    <main className="pb-24 font-sterling">
      <div className="px-4 flex flex-col justify-around gap-1 mb-4">
        <h1 className="text-2xl font-medium">Earn</h1>
        <p className="font-poppins">Complete challenges to earn AkibaMiles.</p>
      </div>

      <MiniPointsCard points={Number(balance)} />

      {/* ── Page-level Active / Completed tabs ───────────── */}
      <Tabs defaultValue="active" className="mx-4">
        <TabsList>
          <TabsTrigger
            value="active"
            className="bg-[#EBEBEB] text-[#8E8B8B]
                       data-[state=active]:bg-[#ADF4FF80]
                       data-[state=active]:text-[#238D9D]
                       rounded-full font-medium"
          >
            Active
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            className="ml-1 bg-[#EBEBEB] text-[#8E8B8B]
                       data-[state=active]:bg-[#ADF4FF80]
                       data-[state=active]:text-[#238D9D]
                       rounded-full font-medium"
          >
            Completed
          </TabsTrigger>
        </TabsList>

        {/* ── ACTIVE tab ─────────────────────────── */}
        <TabsContent value="active">
          <div className="mt-6 gap-1">
            <h3 className="text-lg font-medium mt-6 mb-2">Daily challenges</h3>
            <p className="text-gray-500">
              Completed a challenge? Click & claim Miles
            </p>
          </div>
          <DailyChallenges />
          <PartnerQuests openPopup={openQuest} />
        </TabsContent>

        {/* ── COMPLETED tab ──────────────────────── */}
        <TabsContent value="completed">
          <h3 className="text-lg font-medium mt-6 mb-2">Completed today</h3>
          <DailyChallenges showCompleted />
        </TabsContent>
      </Tabs>

      {/* Pass Badges (always render to avoid "no badges" impression) */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center my-2">
          <h3 className="text-lg font-medium">Pass Badges</h3>

          {passport.status === "has" && (
              <button
              type="button"
              className="flex items-center" disabled={badgeBusy}
              onClick={async () => {
                if (passport.status !== "has") return;
                if (badgeBusy) return;
              
                const safe = passport.safe;
              
                // If we currently think it's claimable, we run claim path.
                // Otherwise we run a "check/refresh" path.
                const doClaim = hasClaimableBadges === true;
              
                setBadgeAction(doClaim ? "claiming" : "checking");
              
                if (doClaim) setBadgeClaimLoadingOpen(true);
              
                try {
                  if (!doClaim) {
                    await refreshBadgesForSafe(safe);
                    return;
                  }
              
                  const unlocked = await claimProsperityBadgesForSafe(safe);
              
                  // Refresh progress + claimable state after claim
                  await refreshBadgesForSafe(safe);
              
                  if (unlocked.length > 0) {
                    setUnlockedBadges(unlocked);
                    setBadgeSheetOpen(true);
                  } else {
                    setUnlockedBadges([]);
                  }
                } catch {
                  // swallow
                } finally {
                  if (doClaim) setBadgeClaimLoadingOpen(false);
                  setBadgeAction("idle");
                }
              }}
              
            >
              <span className="text-sm text-[#238D9D] hover:underline font-medium">
                {badgeButtonLabel}
              </span>
              <span className={`ml-1 inline-flex ${badgeBusy ? "animate-spin" : ""}`}>
  <Image src={RefreshSvg} alt="Refresh Icon" width={24} height={24} className="w-6 h-6" />
</span>

            </button>
          )}
        </div>

        {passport.status === "loading" && (
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="text-sm text-gray-500 mb-3">Loading your badges…</div>
            <div className="space-y-3 animate-pulse">
              <div className="h-10 rounded-lg bg-gray-100" />
              <div className="h-10 rounded-lg bg-gray-100" />
              <div className="h-10 rounded-lg bg-gray-100" />
            </div>
          </div>
        )}

        {passport.status === "none" && (
          <div className="text-sm text-gray-500">
            Get Prosperity Pass to unlock badges.
          </div>
        )}

        {passport.status === "has" && <BadgesSection progress={badgeProgress} />}
      </div>

      <BadgeClaimLoadingSheet
        open={badgeClaimLoadingOpen}
        onOpenChange={setBadgeClaimLoadingOpen}
      />

      <BadgeClaimSuccessSheet
        open={badgeSheetOpen}
        onOpenChange={(open) => {
          setBadgeSheetOpen(open);
          if (!open) setIsRefreshingBadges(false);
        }}
        unlocked={unlockedBadges}
      />

      {/* Partner quest sheets / modals */}
      <EarnPartnerQuestSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        quest={quest}
        setOpenSuccess={setSuccess}
      />
      <SuccessModal openSuccess={success} setOpenSuccess={setSuccess} />
    </main>
  );
}
