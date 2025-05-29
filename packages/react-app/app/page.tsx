"use client";

import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import { GameCard } from "@/components/game-card";
import JoinRafflesCarousel from "@/components/join-raffle-carousel";
import PointsCard from "@/components/points-card";
import { RaffleCard } from "@/components/raffle-card";
import RafflesWonCard from "@/components/raffle-won-card";
import { SectionHeading } from "@/components/section-heading";
import { useWeb3 } from "@/contexts/useWeb3";
import { RaffleImg1, RaffleImg2, RaffleImg3, WinImg } from "@/lib/img";
import { Celo, MinimilesSymbol } from "@/lib/svg";
import { useEffect, useState } from "react";
import { fetchActiveRaffles, Raffle } from "@/helpers/raffledisplay";
import Link from "next/link";
// import SpendPartnerQuestSheet from '@/components/spend-partner-quest-sheet';
import { StaticImageData } from "next/image";
import dynamic from 'next/dynamic'
import { RaffleDetails } from "@/components/raffle-details";
import truncateEthAddress from "truncate-eth-address";
import SuccessModal from "@/components/success-modal";

const SpendPartnerQuestSheet = dynamic(
  () => import('@/components/spend-partner-quest-sheet'),
  { ssr: false }
)


const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  cKES: RaffleImg3,
  // default fallback:
  default: MinimilesSymbol,
}

const upcomingGames = [
  { name: "Dice", date: "xx/xx/xx", image: "/dice.jpg" },
  { name: "Coin flip", date: "xx/xx/xx", image: "/coin.jpg" },
];

export default function Home() {
  const { address, getUserAddress, getMiniMilesBalance } = useWeb3();
  const [miniMilesBalance, setMiniMilesBalance] = useState("0");
  const [showPopup, setShowPopup] = useState(false);
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [loading, setLoading] = useState(true)
  const [spendSheetOpen, setSpendSheetOpen] = useState(false);
  const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [openSuccess, setOpenSuccess] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  type SpendRaffle = {
    id: number;
    title: string;
    reward: string;
    prize: string;
    endDate: string;
    ticketCost: string;
    image: StaticImageData;
    balance: number;
    symbol: string;
  };


  useEffect(() => {
    getUserAddress();
  }, []);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getMiniMilesBalance();
        setMiniMilesBalance(balance);
      } catch (error) {
        console.log(error);
      }
    };
    fetchBalance();
  }, [address, getMiniMilesBalance]);

  useEffect(() => {
    fetchActiveRaffles()
      .then(setRaffles)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div>Loading…</div>

  const formatEndsIn = (ends: number) => {
    const secondsLeft = ends - Math.floor(Date.now() / 1000);
    const days = Math.floor(secondsLeft / (60 * 60 * 24));
    return `${days} days`;
  };

  return (
    <main className="pb-24 font-sterling bg-white">
      <DashboardHeader name={truncateEthAddress(address ?? "")} />
      <PointsCard points={Number(miniMilesBalance)} />
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium mt-6 mb-2">Daily challenges</h3>
          <Link href='/earn'>
            <span className="text-sm text-green-600 hover:underline">See All ›</span>
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          <DailyChallenges />
        </div>
      </div>
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Join Raffles</h3>
          <Link href='/spend'>
            <span className="text-sm text-green-600 hover:underline">View more ›</span>
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          {raffles.map((r) => (
            <RaffleCard
              key={r.id}
              image={r.image ?? RaffleImg1}
              title={`${r.rewardPool} ${r.symbol} weekly`}
              endsIn={formatEndsIn(r.ends)}
              ticketCost={`${r.ticketCost} MiniMiles for 1 ticket`}
              icon={MinimilesSymbol}
              onClick={() => {
                const img = TOKEN_IMAGES[r.symbol] ?? TOKEN_IMAGES.default
                setSpendRaffle({
                  id: Number(r.id),
                  title: `${r.symbol} raffle`,
                  reward: `${r.ticketCost} MiniMiles`,
                  prize: r.rewardPool ?? "—",
                  endDate: formatEndsIn(r.ends),
                  ticketCost: `${r.ticketCost} MiniMiles`,
                  image: img as StaticImageData,
                  balance: Number(miniMilesBalance),
                  symbol: r.symbol
                });
                setSpendSheetOpen(true);
              }}
            />
          ))}
        </div>
      </div>
      {hasMounted && (<SpendPartnerQuestSheet
        open={spendSheetOpen}
        onOpenChange={setSpendSheetOpen}
        raffle={spendRaffle}
      />)}
    </main>

  );
}
