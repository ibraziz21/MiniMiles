// src/app/page.tsx (Home)
"use client";

import ReferFab from "@/components/refer-fab";
import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import ProfileCtaCard from "@/components/profile-cta-card";
import PointsCard from "@/components/points-card";
import { useWeb3 } from "@/contexts/useWeb3";
import { akibaMilesSymbolAlt } from "@/lib/svg";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import truncateEthAddress from "truncate-eth-address";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ProsperityPassCard } from "@/components/prosperity-claim";
import { ActiveStreaksSheet } from "@/components/active-streaks-sheet";
import { RaffleCard } from "@/components/raffle-card";
import {
  fetchActiveRaffles,
  type TokenRaffle,
  type PhysicalRaffle,
} from "@/helpers/raffledisplay";
import { RaffleImg1, RaffleImg2, RaffleImg3, RaffleImg5, usdtround } from "@/lib/img";
import { StaticImageData } from "next/image";

// Passport helper
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const WinningModal = dynamic(() => import("@/components/winning-modal"), {
  ssr: false,
});

type PassportState =
  | { status: "idle" | "loading" | "none" }
  | { status: "has"; safe: `0x${string}` };

type ProfileSummary = {
  username: string | null;
  full_name: string | null;
  completion: number;
  profile_milestone_50_claimed: boolean;
  profile_milestone_100_claimed: boolean;
};

const TOKEN_IMAGES: Record<string, StaticImageData | string> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: usdtround,
};

function formatEndsIn(ends: number): string {
  const diff = ends - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

export default function Home() {
  const router = useRouter();
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getakibaMilesBalance } = web3;

  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [streakSheetOpen, setStreakSheetOpen] = useState(false);
  const [streakSummary, setStreakSummary] = useState({ activeCount: 0, claimableCount: 0, urgentCount: 0 });

  const [displayName, setDisplayName] = useState<string>("");
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [passport, setPassport] = useState<PassportState>({ status: "idle" });
  const hasPassport = passport.status === "has";

  const [tokenRaffles, setTokenRaffles] = useState<TokenRaffle[]>([]);
  const [physicalRaffles, setPhysicalRaffles] = useState<PhysicalRaffle[]>([]);
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
    if (!address) {
      setProfileSummary(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/users/${address.toLowerCase()}`, {
          cache: "no-store",
        });

        if (!res.ok) return;

        const data = await res.json();
        if (cancelled) return;

        setProfileSummary({
          username: data?.username ?? null,
          full_name: data?.full_name ?? null,
          completion: Number(data?.completion ?? 0),
          profile_milestone_50_claimed:
            data?.profile_milestone_50_claimed === true,
          profile_milestone_100_claimed:
            data?.profile_milestone_100_claimed === true,
        });
      } catch {
        if (!cancelled) setProfileSummary(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  // passport check (just enough to know if user has pass)
  useEffect(() => {
    if (!address) { setPassport({ status: "none" }); return; }
    let cancelled = false;
    setPassport({ status: "loading" });
    (async () => {
      try {
        const result: any = await fetchSuperAccountForOwner(address);
        if (cancelled) return;
        const safe = result?.hasPassport && result?.account?.smartAccount
          ? (result.account.smartAccount as `0x${string}`) : null;
        setPassport(safe ? { status: "has", safe } : { status: "none" });
      } catch { if (!cancelled) setPassport({ status: "none" }); }
    })();
    return () => { cancelled = true; };
  }, [address]);

  // fetch active raffles
  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles, physicalRaffles }) => {
        setTokenRaffles(tokenRaffles);
        setPhysicalRaffles(physicalRaffles);
      })
      .catch(() => {});
  }, []);

  const headerName = displayName || (address ? truncateEthAddress(address) : "");

  return (
    <main className="pb-24 font-sterling">
      {/* 🏆 Winner modal only mounts when user opens from the header icon */}
      {winnerOpen && (
        <WinningModal open={winnerOpen} onOpenChange={setWinnerOpen} />
      )}

      <ActiveStreaksSheet
        open={streakSheetOpen}
        onOpenChange={setStreakSheetOpen}
        onSummaryChange={setStreakSummary}
        userAddress={address ?? undefined}
      />

      <DashboardHeader
        name={headerName}
        onOpenWinners={() => setWinnerOpen(true)}
        onOpenStreaks={() => setStreakSheetOpen(true)}
        streakCount={streakSummary.activeCount}
        claimableStreakCount={streakSummary.claimableCount}
        urgentStreakCount={streakSummary.urgentCount}
      />

      <PointsCard points={Number(akibaMilesBalance)} />

      {/* Skill games promo */}
      <div className="mx-4 mt-4">
        <Link href="/games" className="block">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#238D9D] via-[#1d7a89] to-[#155f6a] px-4 py-3.5 shadow-lg shadow-[#238D9D]/30 active:scale-[0.99] transition-transform">
            {/* decorative circles */}
            <div className="pointer-events-none absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/10" />

            <div className="relative flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70 flex items-center gap-1">
                    Skill Games ·
                    <Image src={akibaMilesSymbolAlt} alt="" width={11} height={11} className="inline" />
                    Rule Tap + Memory
                  </span>
                </div>

                <p className="text-[18px] font-extrabold text-white leading-tight">
                  Play short rounds, win Miles
                  <span className="ml-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-black tracking-wide">NEW</span>
                </p>
                <p className="text-[11px] text-white/70 mt-0.5 flex items-center gap-1">
                  Shared tickets · 30 total plays daily · up to
                  <Image src={akibaMilesSymbolAlt} alt="" width={10} height={10} className="inline" />
                  12 per round
                </p>
              </div>

              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                <div className="rounded-full bg-white/20 border border-white/30 px-3 py-1.5">
                  <span className="text-[12px] font-bold text-white">Play →</span>
                </div>
                <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                  <Image src={akibaMilesSymbolAlt} alt="" width={10} height={10} className="inline" />
                  5 entry
                </span>
              </div>
            </div>
          </div>
        </Link>
      </div>


      {address &&
        profileSummary &&
        profileSummary.completion < 100 && (
        <ProfileCtaCard
          completion={profileSummary.completion}
          profileName={profileSummary.full_name ?? profileSummary.username}
          milestone50Claimed={profileSummary.profile_milestone_50_claimed}
          milestone100Claimed={profileSummary.profile_milestone_100_claimed}
          onOpenProfile={() => router.push("/profile")}
        />
      )}

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

      {/* Active Raffle Campaigns */}
      {(tokenRaffles.length > 0 || physicalRaffles.length > 0) && (
        <div className="mx-4 mt-6">
          <div className="flex justify-between items-center my-2">
            <h3 className="text-lg font-medium">AkibaMiles x Minipay Mid-Year Campaign</h3>
            <Link href="/spend">
              <span className="text-sm text-[#238D9D] hover:underline font-medium">See All ›</span>
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {tokenRaffles.map((r) => {
              const img = r.cardImageUrl ?? TOKEN_IMAGES[r.token.symbol] ?? TOKEN_IMAGES.default;
              return (
                <Link key={r.id} href="/spend" className="shrink-0">
                  <RaffleCard
                    image={img}
                    title={r.cardTitle ?? `${r.rewardPool} ${r.token.symbol} Raffle`}
                    endsIn={formatEndsIn(r.ends)}
                    ticketCost={`${r.ticketCost} AkibaMiles`}
                    icon={akibaMilesSymbolAlt}
                    locked={false}
                    onClick={() => {}}
                  />
                </Link>
              );
            })}
            {physicalRaffles.map((r) => {
              const img = r.cardImageUrl ?? usdtround;
              return (
                <Link key={r.id} href="/spend" className="shrink-0">
                  <RaffleCard
                    image={img}
                    title={r.cardTitle ?? "Physical Prize Raffle"}
                    endsIn={formatEndsIn(r.ends)}
                    ticketCost={`${r.ticketCost} AkibaMiles`}
                    icon={akibaMilesSymbolAlt}
                    locked={false}
                    onClick={() => {}}
                  />
                </Link>
              );
            })}
          </div>
        </div>
      )}

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

      <ReferFab />
    </main>
  );
}
