// src/app/page.tsx (Home)
"use client";

import { fetchBadgeProgress } from "@/helpers/fetchBadgeProgress";
import ReferFab from "@/components/refer-fab";
import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import { RaffleCard } from "@/components/raffle-card";
import PointsCard from "@/components/points-card";
import { SectionHeading } from "@/components/section-heading";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  RaffleImg1,
  RaffleImg2,
  RaffleImg3,
  RaffleImg5,
  ps5,
  tv,
  soundbar,
  ebike,
  usdt,
  phone,
  pods,
  laptop,
  jbl,
  bag,
  docking, camera, washmachine, chair
} from "@/lib/img";
import { akibaMilesSymbol, RefreshSvg } from "@/lib/svg";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchActiveRaffles,
  PhysicalRaffle,
  type TokenRaffle,
} from "@/helpers/raffledisplay";
import Link from "next/link";
import type { StaticImageData } from "next/image";
import dynamic from "next/dynamic";
import truncateEthAddress from "truncate-eth-address";
import type { PhysicalSpendRaffle } from "@/components/physical-raffle-sheet";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";import { ProsperityPassCard } from "@/components/prosperity-claim";
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


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

/** ───────────────── Token raffle image map ───────────────── */
const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: RaffleImg3,
};

const PHYSICAL_IMAGES: Record<number, StaticImageData> = {
  108: ps5,
  109: ebike,
  113: phone,
  114: pods,
  116: laptop,
  117: jbl,
  118: bag,

  133: phone,
  134: bag,
  136: laptop,
  137: docking,
  139: pods,
  140: jbl,
   142: camera,
  143: washmachine,
  144: chair,
};

const PHYSICAL_TITLES: Record<number, string> = {
  108: "Playstation 5",
  109: "Electric Bike",
  113: "Samsung A24 (Smartphone) ",
  114: "Earpods (Oraimo) ",
  116: "Laptop",
  117: "JBL Speaker",
  118: "Laptop Bag",
  120: "Marshall Headphones",
  121: "Samsung Galaxy Tab",
  123: "Ring Video Camera",
  124: "Samsung Galaxy Watch 4",
  126: "Nintendo Switch",
  127: "Microwave Oven",
  128: "Refrigerator",
  130: "43 inch TV",
  131: "Projector",
  133: "Samsung A24 (Smartphone)",
  134: "Laptop Bag",
  136: "Laptop",
  137: "Docking Station ",
  139: "Oraimo Earpods",
  140: "JBL Speaker",
  142: "Canon EOS 1200D Camera",
  143: "Washing Machine",
  144: "Gaming Chair",
};


const pickPhysicalImage = (raffle: PhysicalRaffle) =>
  PHYSICAL_IMAGES[raffle.id] ?? soundbar;

const physicalTitle = (raffle: PhysicalRaffle) =>
  PHYSICAL_TITLES[raffle.id] ?? "Physical prize";

/** ─────────────── Extend TokenRaffle with winners ────────── */
export type TokenRaffleWithWinners = TokenRaffle & { winners: number };

/** ───────────────── Spend sheet payload ──────────────────── */
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

export default function Home() {
  const router = useRouter();
  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();

  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");
  const [winnerOpen, setWinnerOpen] = useState(false);

  const [tokenRaffles, setTokenRaffles] = useState<TokenRaffleWithWinners[]>(
    []
  );
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
  //Auto-Refresh
  const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";

const refreshMilesBalance = useCallback(async () => {
  if (!address) return;
  try {
    const balance = await getakibaMilesBalance();
    setakibaMilesBalance(balance);
  } catch {
    // swallow
  }
}, [address, getakibaMilesBalance]);

// Helps when tx receipt is mined but RPC/cache/indexing lags a bit
const refreshMilesBalanceSoon = useCallback(() => {
  void refreshMilesBalance();
  window.setTimeout(() => void refreshMilesBalance(), 1500);
  window.setTimeout(() => void refreshMilesBalance(), 4500);
}, [refreshMilesBalance]);


  useEffect(() => setHasMounted(true), []);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    void refreshMilesBalance();
  }, [refreshMilesBalance]);

  useEffect(() => {
    const handler = () => refreshMilesBalanceSoon();
    window.addEventListener(BALANCE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(BALANCE_REFRESH_EVENT, handler);
  }, [refreshMilesBalanceSoon]);
  

  /** ───────── fetch username (if set) ───────── */
  useEffect(() => {
    if (!address) {
      setDisplayName("");
      return;
    }
    const loadUsername = async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("username")
          .eq("user_address", address.toLowerCase())
          .maybeSingle();

        if (error) {
          console.error("[Home] fetch username error:", error);
          setDisplayName(truncateEthAddress(address));
          return;
        }

        if (data?.username) {
          setDisplayName(data.username as string);
        } else {
          setDisplayName(truncateEthAddress(address));
        }
      } catch (e) {
        console.error("[Home] username fetch exception:", e);
        setDisplayName(truncateEthAddress(address));
      }
    };

    void loadUsername();
  }, [address]);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;

    (async () => {
      const values = await fetchBadgeProgress(address as `0x${string}`);
      if (!cancelled) setBadgeProgress(values);
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  const refreshBadgesForSafe = async (safe: `0x${string}`) => {
    // 1) Paint cached claimable state instantly (optional)
    const cached = readBadgeCache(safe);
    if (typeof cached?.hasClaimableBadges === "boolean") {
      setHasClaimableBadges(cached.hasClaimableBadges);
    }
  
    // 2) Fetch claimable state from Prosperity SAFE endpoint
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
  
    setHasClaimableBadges(claimableExists);
  
    // Cache only claimable state here (do NOT cache raw metrics in this safe cache)
    writeBadgeCache(safe, {
      badgeProgress: badgeProgress, // or remove this field from cache entirely
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

  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles, physicalRaffles }) => {
        const withWinners: TokenRaffleWithWinners[] = tokenRaffles.map((r) => ({
          ...r,
          winners: r.id === 112 ? 5 : 1,
        }));

        setTokenRaffles(withWinners);
        setPhysicalRaffles(physicalRaffles);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
  const claimDisabled = badgeBusy || !hasClaimableBadges;

const badgeButtonLabel =
  badgeAction === "claiming" ? "Claiming…" : "Claim Badges";
  
  // ─────────────────────────────────────────────
  // Physical raffle grouping
  // ─────────────────────────────────────────────
  const TOP_PRIZE_IDS = new Set<number>([108, 109]); // PS5 + E-bike
  const ADVENT_DAILY_IDS = new Set<number>([113,114,116, 117, 118, 120,121,123,124,125, 126,127,128, 130, 131, 133, 134, 136, 137, 139, 140, 142,143,144]); // TV + Soundbar

  const topPrizes = physicalRaffles.filter((r) => TOP_PRIZE_IDS.has(r.id));
  const adventDaily = physicalRaffles.filter((r) => ADVENT_DAILY_IDS.has(r.id));

  const openPhysical = (r: PhysicalRaffle) => {
    const cardImg = pickPhysicalImage(r);
    const title = physicalTitle(r);

    setSpendRaffle(null);
    setPhysicalRaffle({
      id: r.id,
      title,
      endDate: formatEndsIn(r.ends),
      ticketCost: r.ticketCost,
      image: cardImg,
      balance: Number(akibaMilesBalance),
      totalTickets: r.totalTickets,
      maxTickets: r.maxTickets,
    });
    setActiveSheet("physical");
  };

  return (
    <main className="pb-24 font-sterling">
      {/* 🏆 Winner modal only mounts when user opens from the header icon */}
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
        <p className="text-gray-500">
          Completed a challenge? Click & claim Miles
        </p>
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
            className="flex items-center"
            disabled={claimDisabled}
            onClick={async () => {
              if (passport.status !== "has") return;
              if (claimDisabled) return;
          
              const safe = passport.safe;
          
              setBadgeAction("claiming");
              setBadgeClaimLoadingOpen(true);
          
              try {
                const unlocked = await claimProsperityBadgesForSafe(safe);
          
                // Refresh progress + claimable state after claim
                await refreshBadgesForSafe(safe);

                refreshMilesBalanceSoon()
          
                if (unlocked.length > 0) {
                  setUnlockedBadges(unlocked);
                  setBadgeSheetOpen(true);
                } else {
                  setUnlockedBadges([]);
                }
              } catch {
                // swallow
              } finally {
                setBadgeClaimLoadingOpen(false);
                setBadgeAction("idle");
              }
            }}
          >
            <span
              className={[
                "text-sm font-medium",
                claimDisabled
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-[#238D9D] hover:underline",
              ].join(" ")}
            >
              {badgeButtonLabel}
            </span>
          
            {/* Only show the icon when claimable / busy (no icon when disabled due to no claimables) */}
            {!claimDisabled && (
              <span className={`ml-1 inline-flex ${badgeBusy ? "animate-spin" : ""}`}>
                <Image
                  src={RefreshSvg}
                  alt="Claim Badges"
                  width={24}
                  height={24}
                  className="w-6 h-6"
                />
              </span>
            )}
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


      {/* PHYSICAL — Top Prizes
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Top Prizes</h3>
        </div>

        <div className="flex gap-3 overflow-x-auto">
          {topPrizes.map((r) => {
            const cardImg = pickPhysicalImage(r);
            const title = physicalTitle(r);

            return (
              <RaffleCard
                key={r.id}
                image={cardImg}
                title={title}
                endsIn={formatEndsIn(r.ends)}
                ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                icon={akibaMilesSymbol}
                locked={false}
                onClick={() => openPhysical(r)}
              />
            );
          })}

          {topPrizes.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No top prizes live right now.
            </div>
          )}
        </div>
      </div>

      {/* PHYSICAL — Advent Daily Prizes */}
      {/* <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Advent Daily Prizes</h3>
        </div>

        <div className="flex gap-3 overflow-x-auto">
          {adventDaily.map((r) => {
            const cardImg = pickPhysicalImage(r);
            const title = physicalTitle(r);

            return (
              <RaffleCard
                key={r.id}
                image={cardImg}
                title={title}
                endsIn={formatEndsIn(r.ends)}
                ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                icon={akibaMilesSymbol}
                locked={false}
                onClick={() => openPhysical(r)}
              />
            );
          })}

          {adventDaily.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No advent daily prizes live right now.
            </div>
          )}
        </div>
      </div>  */}

      {/* TOKEN / Join Rewards */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Digital Cash Prizes</h3>
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

      {/* Sheets */}
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
