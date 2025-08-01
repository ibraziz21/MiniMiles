"use client";

import ReferFab from "@/components/refer-fab";
import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import { GameCard } from "@/components/game-card";
import JoinRafflesCarousel from "@/components/join-raffle-carousel";
import PointsCard from "@/components/points-card";
import { RaffleCard } from "@/components/raffle-card";
import RafflesWonCard from "@/components/raffle-won-card";
import { SectionHeading } from "@/components/section-heading";
import { useWeb3 } from "@/contexts/useWeb3";
import { RaffleImg1, RaffleImg2, RaffleImg3, RaffleImg5, WinImg } from "@/lib/img";
import { Celo, akibaMilesSymbol } from "@/lib/svg";
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
  Miles: RaffleImg5,
  // default fallback:
  default: RaffleImg3,
}

const upcomingGames = [
  { name: "Dice", date: "xx/xx/xx", image: "/dice.jpg" },
  { name: "Coin flip", date: "xx/xx/xx", image: "/coin.jpg" },
];

export default function Home() {
  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");
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
    totalTickets: number;
    maxTickets: number;
  };


  useEffect(() => {
    getUserAddress();
  }, []);

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
      .then(setRaffles)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div>Loading…</div>

  const formatEndsIn = (ends: number) => {
    const nowSec      = Math.floor(Date.now() / 1000);
    let   secondsLeft = ends - nowSec;
  
    if (secondsLeft <= 0) return 'Ended';
  
    const days = Math.floor(secondsLeft / 86_400); // 24 h
    if (days >= 1) return `${days}d`;
  
    const hours = Math.floor(secondsLeft / 3_600);
    secondsLeft -= hours * 3_600;
    const mins  = Math.floor(secondsLeft / 60);
  
    // “4h 0m” looks odd → show just hours if minutes = 0
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <main className="pb-24 font-sterling">
      <DashboardHeader name={truncateEthAddress(address ?? "")} />
      <PointsCard points={Number(akibaMilesBalance)} />
      <div className="mx-4 mt-6 gap-1">
        <div className="flex justify-between items-center my-2">
          <h3 className="text-lg font-medium">Daily challenges</h3>
          <Link href='/earn'>
            <span className="text-sm text-[#238D9D] hover:underline font-medium">See All ›</span>
          </Link>
        </div>
        <p className="text-gray-500">Completed a challenge? Click & claim Miles</p>
        <div className="flex gap-3 overflow-x-auto">
          <DailyChallenges />
        </div>
      </div>
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Join Raffles</h3>
          <Link href='/spend'>
            <span className="text-sm text-[#238D9D] hover:underline">View more ›</span>
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto">
        {raffles.map((r) => {
    /* pick image in priority order:
       1) subgraph-supplied r.image
       2) symbol-based fallback from TOKEN_IMAGES
       3) generic default */
    const cardImg =
      r.image ??
      TOKEN_IMAGES[r.symbol] ??
      TOKEN_IMAGES.default;

    return (
      <RaffleCard
        key={r.id}
        image={cardImg}
        title={`${r.rewardPool} ${r.symbol}`}
        endsIn={formatEndsIn(r.ends)}
        ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
        locked={false}
        icon={akibaMilesSymbol}
        onClick={() => {
          setSpendRaffle({
            id: Number(r.id),
            title: r.description,
            reward: `${r.ticketCost} AkibaMiles`,
            prize: r.rewardPool ?? "—",
            endDate: formatEndsIn(r.ends),
            ticketCost: `${r.ticketCost} AkibaMiles`,
            image: cardImg,
            balance: Number(akibaMilesBalance),
            symbol: r.symbol,
            maxTickets: r.maxTickets,
            totalTickets: r.totalTickets!
          });
          setSpendSheetOpen(true);
        }}
      />
    );
  })}
        </div>
      </div>
      {hasMounted && (<SpendPartnerQuestSheet
        open={spendSheetOpen}
        onOpenChange={setSpendSheetOpen}
        raffle={spendRaffle}
      />)}
    <ReferFab />
       
    </main>
    

  );
}
