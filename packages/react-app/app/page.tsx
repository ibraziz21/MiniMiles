// src/app/page.tsx
"use client";

import ReferFab from "@/components/refer-fab";
import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import { RaffleCard } from "@/components/raffle-card";
import PointsCard from "@/components/points-card";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  RaffleImg1,
  RaffleImg2,
  RaffleImg3,
  RaffleImg5,
  sambuds,
  oraimo,
  smartwatch,
  speaker,
  credo,
} from "@/lib/img";
import { akibaMilesSymbol, RefreshSvg } from "@/lib/svg";
import Image, { type StaticImageData } from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  fetchActiveRaffles,
  PhysicalRaffle,
  type TokenRaffle,
} from "@/helpers/raffledisplay";
import Link from "next/link";
import dynamic from "next/dynamic";
import truncateEthAddress from "truncate-eth-address";
import type { PhysicalSpendRaffle } from "@/components/physical-raffle-sheet";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ProsperityPassCard } from "@/components/prosperity-claim";
import { BadgesSection } from "@/components/BadgesSection";

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
/*  Supabase setup (client-side)                                   */
/*  NOTE: Do NOT expose service role keys on the client.           */
/*        Prefer NEXT_PUBLIC_SUPABASE_ANON_KEY.                    */
/* ──────────────────────────────────────────────────────────────── */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  // fallback only to avoid breaking existing envs, but should be removed
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY ||
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ──────────────────────────────────────────────────────────────── */
/*  Dynamic imports                                                */
/* ──────────────────────────────────────────────────────────────── */

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

const PhysicalRaffleSheet = dynamic(
  () => import("@/components/physical-raffle-sheet"),
  { ssr: false }
);

const SpendPartnerQuestSheet = dynamic(
  () => import("@/components/spend-partner-quest-sheet"),
  { ssr: false }
);

const WinningModal = dynamic(() => import("@/components/winning-modal"), {
  ssr: false,
});

/* ──────────────────────────────────────────────────────────────── */
/*  Raffle image mapping                                           */
/* ──────────────────────────────────────────────────────────────── */

const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: RaffleImg3,
};

const PHYSICAL_IMAGES: Record<number, StaticImageData> = {
  93: oraimo,
  94: smartwatch,
  95: speaker,
  97: credo,
};

const PHYSICAL_TITLES: Record<number, string> = {
  93: "Oraimo SpaceBuds Neo",
  94: "Samsung Watch 5 40mm Bluetooth Smartwatch - Black",
  95: 'Bluetooth Speakers HIFI Boomboxes For Laptop,TV',
  97: "KES 500 Airtime Reward",
};

const pickPhysicalImage = (raffle: PhysicalRaffle) =>
  PHYSICAL_IMAGES[raffle.id] ?? sambuds;

const physicalTitle = (raffle: PhysicalRaffle) =>
  PHYSICAL_TITLES[raffle.id] ?? "Physical prize";

/* ──────────────────────────────────────────────────────────────── */
/*  Types                                                         */
/* ──────────────────────────────────────────────────────────────── */

export type TokenRaffleWithWinners = TokenRaffle & { winners: number };

export type SpendRaffle = {
  id: number;
  title: string;
  reward: string;
  prize: string;
  endDate: string;
  ticketCost: string;
  image: StaticImageData;
  balance: number;
  symbol: string;
  totalTickets: number;
  maxTickets: number;
  winners?: number;
};

type PassportState =
  | { status: "idle" | "loading" | "none" }
  | { status: "has"; safe: `0x${string}` };

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

/* ──────────────────────────────────────────────────────────────── */
/*  Component                                                      */
/* ──────────────────────────────────────────────────────────────── */

export default function Home() {
  const router = useRouter();
  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();

  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [tokenRaffles, setTokenRaffles] = useState<TokenRaffleWithWinners[]>([]);
  const [physicalRaffles, setPhysicalRaffles] = useState<PhysicalRaffle[]>([]);
  const [loading, setLoading] = useState(true);

  const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);
  const [physicalRaffle, setPhysicalRaffle] =
    useState<PhysicalSpendRaffle | null>(null);
  const [activeSheet, setActiveSheet] = useState<null | "token" | "physical">(
    null
  );
  const [hasMounted, setHasMounted] = useState(false);

  const [displayName, setDisplayName] = useState<string>("");

  // Badge UI state
  const [passport, setPassport] = useState<PassportState>({ status: "idle" });
  const hasPassport = passport.status === "has";

  const [badgeSheetOpen, setBadgeSheetOpen] = useState(false);
  const [unlockedBadges, setUnlockedBadges] = useState<string[]>([]);
  const [isRefreshingBadges, setIsRefreshingBadges] = useState(false);
  const [badgeProgress, setBadgeProgress] = useState<BadgeProgress>(
    EMPTY_BADGE_PROGRESS
  );
  const [hasClaimableBadges, setHasClaimableBadges] = useState(false);
  const [badgeClaimLoadingOpen, setBadgeClaimLoadingOpen] = useState(false);
  const [badgeAction, setBadgeAction] = useState<
  "idle" | "checking" | "claiming"
>("idle");

const badgeBusy = badgeAction !== "idle";


  /* ───────── Initial mount ───────── */
  useEffect(() => setHasMounted(true), []);

  /* ───────── Address from MiniPay / Wallet ───────── */
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  /* ───────── Balance ───────── */
  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getakibaMilesBalance();
        setakibaMilesBalance(balance);
      } catch {
        // swallow
      }
    };
    void fetchBalance();
  }, [address, getakibaMilesBalance]);

  /* ───────── Username / displayName ───────── */
  useEffect(() => {
    if (!address) {
      setDisplayName("");
      return;
    }

    let cancelled = false;

    const loadUsername = async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("username")
          .eq("user_address", address.toLowerCase())
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          setDisplayName(truncateEthAddress(address));
          return;
        }

        setDisplayName(
          data?.username ? (data.username as string) : truncateEthAddress(address)
        );
      } catch {
        if (!cancelled) setDisplayName(truncateEthAddress(address));
      }
    };

    void loadUsername();

    return () => {
      cancelled = true;
    };
  }, [address]);

  /* ──────────────────────────────────────────────────────────────── */
  /*  Badges: fast perceived load                                   */
  /*   - single pipeline: fetch passport once → safe                */
  /*   - paint from cache immediately                               */
  /*   - do not wipe badges on transient fetch failures             */
  /* ──────────────────────────────────────────────────────────────── */

  const refreshBadgesForSafe = async (safe: `0x${string}`) => {
    // 1) Paint cached state instantly (if any)
    const cached = readBadgeCache(safe);
    if (cached?.badgeProgress) setBadgeProgress(cached.badgeProgress);
    if (typeof cached?.hasClaimableBadges === "boolean") {
      setHasClaimableBadges(cached.hasClaimableBadges);
    }

    // 2) Fetch real state
    const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
    const url = `${base}/api/user/${safe}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      // keep cached UI, don’t hard-reset
      return;
    }

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

  // passport + safe pipeline
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

        // paint from cache instantly (if present) + fetch fresh
        void refreshBadgesForSafe(safe);
      } catch {
        if (!cancelled) setPassport({ status: "none" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Claim badges (safe-only; no extra passport lookups)
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

  /* ───────── Raffles ───────── */
  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles, physicalRaffles }) => {
        const withWinners: TokenRaffleWithWinners[] = tokenRaffles.map((r) => ({
          ...r,
          winners: r.id === 96 ? 5 : 1,
        }));

        setTokenRaffles(withWinners);
        setPhysicalRaffles(physicalRaffles);
      })
      .catch(() => {
        // swallow
      })
      .finally(() => setLoading(false));
  }, []);

  /* ───────── Misc helpers ───────── */

  if (loading) return <div>Loading…</div>;

  

  const formatEndsIn = (ends: number) => {
    const nowSec = Math.floor(Date.now() / 1000);
    let secondsLeft = ends - nowSec;

    if (secondsLeft <= 0) return "Ended";

    const days = Math.floor(secondsLeft / 86_400);
    if (days >= 1) return `${days}d`;

    const hours = Math.floor(secondsLeft / 3_600);
    secondsLeft -= hours * 3_600;
    const mins = Math.floor(secondsLeft / 60);

    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const headerName = displayName || (address ? truncateEthAddress(address) : "");

  const badgeButtonLabel =
  badgeAction === "checking"
    ? "Checking…"
    : badgeAction === "claiming"
    ? "Claiming…"
    : hasClaimableBadges
    ? "Claim Badges"
    : "Refresh Badges";


  /* ───────── Render ───────── */

  return (
    <main className="pb-24 font-sterling">
      {/* Winner modal */}
      {winnerOpen && (
        <WinningModal open={winnerOpen} onOpenChange={setWinnerOpen} />
      )}

      <DashboardHeader
        name={headerName}
        onOpenWinners={() => setWinnerOpen(true)}
      />
      <PointsCard points={Number(akibaMilesBalance)} />

      {/* Create/claim Prosperity Pass */}
      {!hasPassport && (
        <ProsperityPassCard onClaim={() => router.push("/prosperity-pass")} />
      )}

      {/* Daily challenges */}
      <div className="mx-4 mt-6 gap-1">
        <div className="flex justify-between items-center my-2">
          <h3 className="text-lg font-medium">Daily challenges</h3>
          <Link href="/earn">
            <span className="text-sm text-[#238D9D] hover:underline font-medium">
              See All ›
            </span>
          </Link>
        </div>
        <p className="text-gray-500">Completed a challenge? Click & claim Miles</p>
        <div className="flex gap-3 overflow-x-auto">
          <DailyChallenges />
        </div>
      </div>

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

      {/* TOKEN / Join Rewards */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Join Rewards</h3>
          <Link href="/spend">
            <span className="text-sm text-[#238D9D] hover:underline">
              View more ›
            </span>
          </Link>
        </div>

        <div className="flex gap-3 overflow-x-auto">
          {tokenRaffles.map((r) => {
            const cardImg =
              (r as any).image ??
              TOKEN_IMAGES[r.token.symbol] ??
              TOKEN_IMAGES.default;

            return (
              <RaffleCard
                key={r.id}
                image={cardImg}
                title={`${r.rewardPool} ${r.token.symbol}`}
                endsIn={formatEndsIn(r.ends)}
                ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                icon={akibaMilesSymbol}
                winners={r.winners}
                locked={false}
                onClick={() => {
                  setSpendRaffle({
                    id: r.id,
                    title: r.description ?? `${r.rewardPool} ${r.token.symbol}`,
                    reward: `${r.rewardPool} ${r.token.symbol}`,
                    prize: `${r.rewardPool} ${r.token.symbol}`,
                    endDate: formatEndsIn(r.ends),
                    ticketCost: `${r.ticketCost} AkibaMiles`,
                    image: cardImg,
                    balance: Number(akibaMilesBalance),
                    symbol: r.token.symbol,
                    maxTickets: r.maxTickets,
                    totalTickets: r.totalTickets,
                    winners: r.winners,
                  });
                  setActiveSheet("token");
                }}
              />
            );
          })}

          {tokenRaffles.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No Rewards live right now.
            </div>
          )}
        </div>
      </div>

      {/* Sheets / modals */}
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

      <PhysicalRaffleSheet
        open={activeSheet === "physical"}
        onOpenChange={(o) => setActiveSheet(o ? "physical" : null)}
        raffle={physicalRaffle}
      />

      {hasMounted && (
        <SpendPartnerQuestSheet
          open={activeSheet === "token"}
          onOpenChange={(o) => setActiveSheet(o ? "token" : null)}
          raffle={spendRaffle}
        />
      )}

      <ReferFab />
    </main>
  );
}
