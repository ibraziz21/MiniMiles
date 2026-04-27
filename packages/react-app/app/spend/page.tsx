"use client";
import dynamic from 'next/dynamic';
import DailyChallenges from '@/components/daily-challenge';
import EnterRaffleSheet from '@/components/enter-raffle-sheet';
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
import { RaffleImg1, RaffleImg2, RaffleImg3, airpods, laptop, bicycle, nft1, nft2, RaffleImg5, pods, phone, jbl,bag, sambuds, tv, soundbar, ps5, ebike, usdt, docking,camera,washmachine,chair} from '@/lib/img';
import { akibaMilesSymbol } from '@/lib/svg';
import { Question } from '@phosphor-icons/react';
import { StaticImageData } from 'next/image';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { MilesAmount } from '@/components/games/miles-amount';
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
  default: RaffleImg3,
}


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

      {/* GAMES */}
      <div className="mt-6 px-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-extrabold">Games</h3>
          <Link href="/games" className="text-xs font-semibold text-[#238D9D]">See all →</Link>
        </div>

        {/* Dice — chance game */}
        <div className="mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#817E7E] mb-2">Chance</p>
          <Link href="/dice" className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#1A3A2A] to-[#204D38] p-4 shadow-sm">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-2xl">
              🎲
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white">Dice</p>
              <p className="text-xs text-white/70 font-poppins">Pick a number · Win the pot</p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-[#4EFFA0]/20 px-2.5 py-1 text-xs font-semibold text-[#4EFFA0]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0] animate-pulse" />
              Live
            </span>
          </Link>
        </div>

        {/* Skill games */}
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#817E7E] mb-2">Skill</p>
        <div className="flex gap-3 overflow-x-auto pb-1">
          <Link
            href="/games/rule-tap"
            className="shrink-0 w-44 rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-4 shadow-sm"
          >
            <span className="text-2xl">⚡</span>
            <p className="mt-2 font-bold text-white text-sm">Rule Tap</p>
            <p className="text-[11px] text-white/70 font-poppins flex items-center gap-0.5">20s · up to <MilesAmount value={35} size={11} variant="alt" /></p>
            <span className="mt-2 inline-flex items-center gap-0.5 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
              <MilesAmount value={5} size={10} variant="alt" /> entry
            </span>
          </Link>
          <Link
            href="/games/memory-flip"
            className="shrink-0 w-44 rounded-2xl bg-gradient-to-br from-[#3B1F6E] to-[#7B4CC0] p-4 shadow-sm"
          >
            <span className="text-2xl">🧠</span>
            <p className="mt-2 font-bold text-white text-sm">Memory Flip</p>
            <p className="text-[11px] text-white/70 font-poppins flex items-center gap-0.5">60s · up to <MilesAmount value={20} size={11} variant="alt" /></p>
            <span className="mt-2 inline-flex items-center gap-0.5 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
              <MilesAmount value={5} size={10} variant="alt" /> entry
            </span>
          </Link>
          <div className="shrink-0 w-44 rounded-2xl bg-[#F0F0F0] p-4 flex flex-col justify-between opacity-60">
            <span className="text-2xl">🪙</span>
            <p className="mt-2 font-bold text-[#525252] text-sm">Coin Flip</p>
            <p className="text-[11px] text-[#817E7E] font-poppins">Coming soon</p>
            <span className="mt-2 inline-block rounded-full bg-[#D0D0D0] px-2 py-0.5 text-[10px] font-semibold text-[#817E7E]">
              Locked
            </span>
          </div>
        </div>
      </div>

<PhysicalRaffleSheet
  open={activeSheet === "physical"}
  onOpenChange={(open: boolean) => setActiveSheet(open ? "physical" : null)}
  raffle={physicalRaffle}
/>

{hasMounted && (
  <SpendPartnerQuestSheet
    open={activeSheet === "token"}
    onOpenChange={(open: boolean) => setActiveSheet(open ? "token" : null)}
    raffle={spendRaffle}
  />
)}


    </main>
  );
}

export default Page;
