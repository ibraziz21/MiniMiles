"use client";
import dynamic from 'next/dynamic';
import DailyChallenges from '@/components/daily-challenge';
import EnterRaffleSheet from '@/components/enter-raffle-sheet';
import { GameCard } from '@/components/game-card';
import { Hero } from '@/components/Hero';
import MiniPointsCard from '@/components/mini-points-card';
import { RaffleCard } from '@/components/raffle-card';
import { RaffleDetails } from '@/components/raffle-details';
import { SectionHeading } from '@/components/section-heading';
import SpendPartnerQuestSheet from '@/components/spend-partner-quest-sheet';
import SuccessModal from '@/components/success-modal';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWeb3 } from '@/contexts/useWeb3';
import type { Address } from 'viem'
import type { PhysicalSpendRaffle } from "@/components/physical-raffle-sheet";
import { Dice, RaffleImg1, RaffleImg2, RaffleImg3, airpods,tab, laptop, bicycle, nft1, nft2, RaffleImg5, pods, phone, jbl,bag, sambuds, tv, soundbar, ps5, ebike, usdt, nintendo, watch, hphone,} from '@/lib/img';
import { Coin, akibaMilesSymbol } from '@/lib/svg';
import { Question } from '@phosphor-icons/react';
import { StaticImageData } from 'next/image';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
const PhysicalRaffleSheet = dynamic(() => import('@/components/physical-raffle-sheet'), { ssr: false });

export type TokenRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  token: { address: Address; symbol: string; decimals: number }
  rewardPool: string        // formatted
  ticketCost: string        // formatted (18d)
  image?: string            // optional if you attach one later
  description?: string
}

export type PhysicalRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  prizeNFT?: Address
  ticketCost: string        // formatted (18d)
  rewardURI?: string        // if you later expose it
}

async function fetchActiveRaffles(): Promise<{
  tokenRaffles: TokenRaffle[]
  physicalRaffles: PhysicalRaffle[]
}> {
  const res = await fetch('/api/Spend/raffle_display', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch raffles')
  return res.json()
}





const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  // default fallback:
  default: usdt,
}

const PHYSICAL_IMAGES: Record<number, StaticImageData> = {
  108: ps5,
  109: ebike,
  113: phone,
  114: pods,
  116: laptop,
  117: jbl,
  118: bag,
  120: hphone,
  121: tab,
  123: watch,
  124: nintendo
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
  123: "Samsung Galaxy Watch 4",
  124: "Nintendo Switch"
};

const pickPhysicalImage = (raffle: PhysicalRaffle) =>
  PHYSICAL_IMAGES[raffle.id] ?? sambuds;

const physicalTitle = (raffle: PhysicalRaffle) =>
  PHYSICAL_TITLES[raffle.id] ?? 'Physical prize';

// Shape it to what SpendPartnerQuestSheet expects:
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



const digitalCashRaffles = [
  { image: RaffleImg1, title: "500 USDT weekly", endsIn: 2, ticketCost: "10 AkibaMiles for 1 ticket" },
  { image: RaffleImg2, title: "250 USDT", endsIn: 5, ticketCost: "6 points for 1 ticket" },
];

const physicalGoodsRaffles = [
  { image: airpods, title: "Airpods 2", endsIn: 6, ticketCost: "3 AkibaMiles for 1 ticket" },
  { image: laptop, title: "Laptop", endsIn: 4, ticketCost: "50 tickets by brand" },
  { image: bicycle, title: "Bicycle", endsIn: 4, ticketCost: "50 tickets by brand" }
];

const nftRaffles = [
  { image: nft1, title: "BoredApe #567", endsIn: 7, ticketCost: "10 AkibaMiles for 1 ticket" },
  { image: nft2, title: "CryptoPunk #789", endsIn: 3, ticketCost: "12 AkibaMiles" },
];

const upcomingGames = [
  { name: "Dice", date: "xx/xx/xx", image: Dice },
  { name: "Coin flip", date: "xx/xx/xx", image: Coin },
];

const Page = () => {

  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [akibaMilesBalance, setakibaMilesBalance] = useState('0');
  const [showPopup, setShowPopup] = useState(false);
  const [selectedRaffle, setSelectedRaffle] = useState<any>(null);
  const [raffleSheetOpen, setRaffleSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true)
  const [tokenRaffles, setTokenRaffles] = useState<TokenRaffle[]>([])
  const [physicalRaffles, setPhysicalRaffles] = useState<PhysicalRaffle[]>([])
  const [activeSheet, setActiveSheet] = useState<null | "token" | "physical">(null);
  const [physicalRaffle, setPhysicalRaffle] = useState<PhysicalSpendRaffle | null>(null);
  const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [openSuccess, setOpenSuccess] = useState(false);


  useEffect(() => {
    setHasMounted(true);
  }, []);

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
      .then(({ tokenRaffles, physicalRaffles }) => {
        setTokenRaffles(tokenRaffles)
        setPhysicalRaffles(physicalRaffles)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const formatEndsIn = (ends: number) => {
    const nowSec = Math.floor(Date.now() / 1000);
    let secondsLeft = ends - nowSec;

    if (secondsLeft <= 0) return 'Ended';

    const days = Math.floor(secondsLeft / 86_400); // 24 h
    if (days >= 1) return `${days}d`;

    const hours = Math.floor(secondsLeft / 3_600);
    secondsLeft -= hours * 3_600;
    const mins = Math.floor(secondsLeft / 60);

    // “4h 0m” looks odd → show just hours if minutes = 0
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <main className="pb-24 font-sterling bg-onboarding">
      <div className="px-4 flex flex-col justify-around gap-1 mb-4">
        <h1 className="text-2xl font-medium">Spend</h1>
        <h3 className='font-poppins'>Win big by entering our Raffles</h3>
      </div>
      <MiniPointsCard points={Number(akibaMilesBalance)} />
      <div className="mx-3">
        <EnterRaffleSheet />
      </div>
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Digital Cash Rewards</h3>
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
      locked={false}
      icon={akibaMilesSymbol}
      onClick={() => {
        setPhysicalRaffle(null);
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
        });
        setActiveSheet("token");     // <-- only this one opens
      }}
    />
  )
})}
        </div>
      </div>

       {/* PHYSICAL */}
       <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Physical Goods Rewards</h3>
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
            <div className="text-sm opacity-70 px-2 py-4">No physical rewards live right now.</div>
          )}
        </div>
      </div>

      {/* NFT (static demo) */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">NFT raffles</h3>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          {nftRaffles.map((raffle, idx) => (
            <RaffleCard
              key={idx}
              image={raffle.image}
              title={raffle.title}
              endsIn={`${raffle.endsIn} days`}
              ticketCost={raffle.ticketCost}
              icon={akibaMilesSymbol}
              locked={true}
              onClick={() => {
                setSpendRaffle({
                  id: idx,
                  title: raffle.title,
                  reward: raffle.ticketCost,
                  prize: raffle.title,
                  endDate: `${raffle.endsIn} days`,
                  ticketCost: raffle.ticketCost,
                  image: raffle.image,
                  balance: Number(akibaMilesBalance),
                  symbol: 'AkibaMiles',
                  maxTickets: 0,
                  totalTickets: 0
                });
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <SectionHeading title="Upcoming games" />
        <div className="flex space-x-3 overflow-x-auto px-4">
  {upcomingGames.map((game, idx) => {
    const locked = game.name !== 'Dice'; // Dice is live, others locked

    const card = (
      <GameCard
        name={game.name}
        date={game.date}
        image={game.image}
        locked={locked}
      />
    );

    if (!locked && game.name === 'Dice') {
      // Dice is live → clickable
      return (
        <Link
          key={idx}
          href="/dice"
          className="shrink-0"
        >
          {card}
        </Link>
      );
    }

    // Locked previews (non-clickable)
    return (
      <div key={idx} className="shrink-0">
        {card}
      </div>
    );
  })}
</div>
</div>

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


    </main>
  );
}

export default Page;