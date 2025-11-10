// src/app/page.tsx (Home)
"use client";

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
  speaker,
  solar,
  hplaptop,
  sambuds,
  promo,
  credo,
  spk,
  vitron,
  power
} from "@/lib/img";
import { akibaMilesSymbol } from "@/lib/svg";
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

const PhysicalRaffleSheet = dynamic(
  () => import("@/components/physical-raffle-sheet"),
  { ssr: false }
);
const SpendPartnerQuestSheet = dynamic(
  () => import("@/components/spend-partner-quest-sheet"),
  { ssr: false }
);

/** ───────────────── Token raffle image map ───────────────── */
const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: RaffleImg3,
};

/** ───────────────── Physical raffle helpers ─────────────── */
const PHYSICAL_IMAGES: Record<number, StaticImageData> = {
  76: spk,
  77: vitron,
  78: power,
  79: credo,
};
const PHYSICAL_TITLES: Record<number, string> = {
  76: "Bluetooth Speakers HIFI Boomboxes For Laptop,TV",
  77: "Vitron HTC3200S, 32 Smart Frameless Android LED TV",
  78: `VIC 40000mAh Power Bank`,
  79: 'KES 500 Airtime Reward, '
};
const pickPhysicalImage = (raffle: PhysicalRaffle) =>
  PHYSICAL_IMAGES[raffle.id] ?? sambuds;
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
  winners?: number  // add if/when your sheet wants it
};

export default function Home() {
  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");

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

  useEffect(() => setHasMounted(true), []);
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getakibaMilesBalance();
        setakibaMilesBalance(balance);
      } catch (error) {
        console.log(error);
      }
    };
    fetchBalance();
  }, [address, getakibaMilesBalance]);

  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles, physicalRaffles }) => {
        // ⬇︎ Add winners: round 73 → 5, others → 1
        const withWinners: TokenRaffleWithWinners[] = tokenRaffles.map((r) => ({
          ...r,
          winners: r.id === 80 ? 5 : 1,
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

  return (
    <main className="pb-24 font-sterling">
      <DashboardHeader name={truncateEthAddress(address ?? "")} />
      <PointsCard points={Number(akibaMilesBalance)} />

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

      {/* PHYSICAL */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Physical Rewards</h3>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          {physicalRaffles.map((r) => {
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
                onClick={() => {
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
                }}
              />
            );
          })}

          {physicalRaffles.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No physical rewards live right now.
            </div>
          )}
        </div>
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
          winners={r.winners}   // ✅ MUST be passed to show the badge
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