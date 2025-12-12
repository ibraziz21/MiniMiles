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
  jbl,
  amaya,
  itel,
  sambuds,
  promo,
  credo,
  spk,
  vitron,
  power,
  speaker,
  oraimo,
  smartwatch,
} from "@/lib/img";
import { akibaMilesSymbol, RefreshSvg } from "@/lib/svg";
import Image from "next/image";
import { useEffect, useState } from "react";
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
/*  Supabase setup                                                 */
/* ──────────────────────────────────────────────────────────────── */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
/*  Types for raffles                                              */
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
  "amg-akiba-games": null, // not wired yet
};

function deriveProgressFromBackendBadge(badge: BackendBadge): number {
  const rawTier =
    typeof badge.tier === "number" && !Number.isNaN(badge.tier)
      ? badge.tier
      : 0;

  const maxSteps =
    Array.isArray(badge.badgeTiers) && badge.badgeTiers.length > 0
      ? badge.badgeTiers.length
      : 5;

  const steps = Math.max(0, Math.min(rawTier, maxSteps));

  return steps;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Component                                                      */
/* ──────────────────────────────────────────────────────────────── */

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
  const [badgeSheetOpen, setBadgeSheetOpen] = useState(false);
  const [unlockedBadges, setUnlockedBadges] = useState<string[]>([]);
  const [isRefreshingBadges, setIsRefreshingBadges] = useState(false);
  const [hasPassport, setHasPassport] = useState(false);

  const [badgeProgress, setBadgeProgress] = useState<
    BadgeProgress | undefined
  >(undefined);

  const [hasClaimableBadges, setHasClaimableBadges] = useState(false);

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
    fetchBalance();
  }, [address, getakibaMilesBalance]);

  /* ───────── Username / displayName ───────── */
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
          setDisplayName(truncateEthAddress(address));
          return;
        }

        if (data?.username) {
          setDisplayName(data.username as string);
        } else {
          setDisplayName(truncateEthAddress(address));
        }
      } catch {
        setDisplayName(truncateEthAddress(address));
      }
    };

    loadUsername();
  }, [address]);

  /* ───────── Check Prosperity Pass (Super Account) ───────── */
  useEffect(() => {
    if (!address) {
      setHasPassport(false);
      return;
    }

    const checkPassport = async () => {
      try {
        const result = await fetchSuperAccountForOwner(address);
        setHasPassport(result.hasPassport);
      } catch {
        setHasPassport(false);
      }
    };

    void checkPassport();
  }, [address]);

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

   /* ───────── Badge refresh helper ───────── */
   const refreshBadges = async (owner: `0x${string}`) => {
    try {
      const result: any = await fetchSuperAccountForOwner(owner);

      const safe =
        result?.hasPassport && result?.account?.smartAccount
          ? (result.account.smartAccount as `0x${string}`)
          : null;

      if (!safe) {
        setBadgeProgress({ ...EMPTY_BADGE_PROGRESS });
        setUnlockedBadges([]);
        setHasClaimableBadges(false);
        return;
      }

      const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
      const url = `${base}/api/user/${safe}`;

      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        setBadgeProgress({ ...EMPTY_BADGE_PROGRESS });
        setUnlockedBadges([]);
        setHasClaimableBadges(false);
        return;
      }

      const data: BackendBadgesResponse = await res.json();
      const backendBadges = data.currentBadges ?? [];

      // Build our step-based progress
      const latest: BadgeProgress = { ...EMPTY_BADGE_PROGRESS };

      (Object.keys(latest) as BadgeKey[]).forEach((key) => {
        const badgeId = BADGE_ID_BY_KEY[key];

        if (badgeId == null) {
          latest[key] = 0;
          return;
        }

        const backendBadge = backendBadges.find(
          (b) => Number(b.badgeId) === badgeId
        );

        if (!backendBadge) {
          latest[key] = 0;
          return;
        }

        const value = deriveProgressFromBackendBadge(backendBadge);
        latest[key] = value;
      });

      setBadgeProgress(latest);

      // NEW: determine if any of the tracked IDs are actually claimable
      const trackedIds = new Set(
        Object.values(BADGE_ID_BY_KEY).filter(
          (id): id is number => id != null
        )
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

      // unlockedBadges still driven by claim flow if you decide to use it
    } catch {
      setBadgeProgress({ ...EMPTY_BADGE_PROGRESS });
      setUnlockedBadges([]);
      setHasClaimableBadges(false);
    }
  };


  async function claimProsperityBadgesForOwner(
    owner: `0x${string}`
  ): Promise<boolean> {
    try {
      const result: any = await fetchSuperAccountForOwner(owner);

      const safe =
        result?.hasPassport && result?.account?.smartAccount
          ? (result.account.smartAccount as `0x${string}`)
          : null;

      if (!safe) {
        return false;
      }

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

      if (!res.ok) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /* ───────── Claim badges (tracked IDs only) then refresh ───────── */
  const claimBadgesAndRefresh = async (owner: `0x${string}`) => {
    try {
      const result: any = await fetchSuperAccountForOwner(owner);

      const safe =
        result?.hasPassport && result?.account?.smartAccount
          ? (result.account.smartAccount as `0x${string}`)
          : null;

      if (!safe) {
        await refreshBadges(owner);
        return;
      }

      const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
      const url = `${base}/api/user/${safe}`;

      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        await refreshBadges(owner);
        return;
      }

      const data: BackendBadgesResponse = await res.json();
      const backendBadges = data.currentBadges ?? [];

      const trackedIds = new Set(
        Object.values(BADGE_ID_BY_KEY).filter(
          (id): id is number => id != null
        )
      );

      const claimableTargets = backendBadges.filter((b) => {
        const idNum = Number(b.badgeId);
        const claimableTier = b.claimableTier ?? 0;
        return (
          trackedIds.has(idNum) &&
          b.claimable === true &&
          claimableTier > 0
        );
      });

      const newlyUnlocked: string[] = [];

      claimableTargets.forEach((b) => {
        const idNum = Number(b.badgeId);
        const claimableTier = b.claimableTier ?? 0;
        const currentTier = b.tier ?? 0;

        const key = (Object.keys(BADGE_ID_BY_KEY) as BadgeKey[]).find(
          (k) => BADGE_ID_BY_KEY[k] === idNum
        );
        if (!key) return;

        const def = BADGES.find((bd) => bd.key === key);
        if (!def) return;

        for (
          let lvl = currentTier + 1;
          lvl <= claimableTier && lvl <= def.tiers.length;
          lvl++
        ) {
          const tierDef = def.tiers[lvl - 1];
          newlyUnlocked.push(`${def.title} • ${tierDef.label}`);
        }
      });

      if (claimableTargets.length === 0) {
        setUnlockedBadges([]);
        await refreshBadges(owner);
        return;
      }

      setUnlockedBadges(newlyUnlocked);

      const claimRes = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });

      try {
        await claimRes.json();
      } catch {
        // swallow
      }

      await refreshBadges(owner);
    } catch {
      await refreshBadges(owner);
    }
  };

  /* ───────── Auto-fetch badges once we know address + hasPassport ───────── */
  useEffect(() => {
    if (!address || !hasPassport) {
      return;
    }

    void refreshBadges(address as `0x${string}`);
  }, [address, hasPassport]);

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

  const headerName =
    displayName || (address ? truncateEthAddress(address) : "");

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
        <p className="text-gray-500">
          Completed a challenge? Click & claim Miles
        </p>
        <div className="flex gap-3 overflow-x-auto">
          <DailyChallenges />
        </div>
      </div>

      {/* Pass Badges – only visible if user HAS Prosperity Pass */}
      {hasPassport && (
        <div className="mx-4 mt-6">
          <div className="flex justify-between items-center my-2">
            <h3 className="text-lg font-medium">Pass Badges</h3>
            <button
              type="button"
              className="flex items-center"
              onClick={async () => {
                if (!address || !hasPassport) {
                  return;
                }

                if (isRefreshingBadges) {
                  return;
                }

                setIsRefreshingBadges(true);

                try {
                  // If no claimable badges, treat this as a pure "Refresh"
                  if (!hasClaimableBadges) {
                    await refreshBadges(address as `0x${string}`);
                    return;
                  }

                  // Otherwise try to claim first
                  const claimed = await claimProsperityBadgesForOwner(
                    address as `0x${string}`
                  );

                  if (!claimed) {
                    // Claim failed → just refresh, do NOT show success modal
                    await refreshBadges(address as `0x${string}`);
                    return;
                  }

                  // Claim succeeded → refresh + show success modal
                  await refreshBadges(address as `0x${string}`);
                  setBadgeSheetOpen(true);
                } catch {
                  // swallow, and leave UI in a safe state
                } finally {
                  setIsRefreshingBadges(false);
                }
              }}
            >
              <span className="text-sm text-[#238D9D] hover:underline font-medium">
                {hasClaimableBadges ? "Claim Badges" : "Refresh Badges"}
              </span>
              <Image
                src={RefreshSvg}
                alt="Refresh Icon"
                width={24}
                height={24}
                className={`w-6 h-6 ml-1 ${
                  isRefreshingBadges ? "animate-spin" : ""
                }`}
              />
            </button>

          </div>

          {/* Active badges */}
          <BadgesSection progress={badgeProgress} />
        </div>
      )}

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

      {/* Physical raffles ... if you display them */}

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
