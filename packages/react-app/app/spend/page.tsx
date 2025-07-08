"use client";

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
import { fetchActiveRaffles, Raffle } from '@/helpers/raffledisplay';
import { Dice, RaffleImg1, RaffleImg2, RaffleImg3, airpods, laptop, bicycle, nft1, nft2 } from '@/lib/img';
import { Coin, akibaMilesSymbol } from '@/lib/svg';
import { Question } from '@phosphor-icons/react';
import { StaticImageData } from 'next/image';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';


const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  cKES: RaffleImg3,
  // default fallback:
  default: akibaMilesSymbol,
}

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
};



const digitalCashRaffles = [
  { image: RaffleImg1, title: "500 USDT weekly", endsIn: 2, ticketCost: "10 akibaMiles for 1 ticket" },
  { image: RaffleImg2, title: "250 USDT", endsIn: 5, ticketCost: "6 points for 1 ticket" },
];

const physicalGoodsRaffles = [
  { image: airpods, title: "Airpods 2", endsIn: 6, ticketCost: "3 akibaMiles for 1 ticket" },
  { image: laptop, title: "Laptop", endsIn: 4, ticketCost: "50 tickets by brand" },
  { image: bicycle, title: "Bicycle", endsIn: 4, ticketCost: "50 tickets by brand" }
];

const nftRaffles = [
  { image: nft1, title: "BoredApe #567", endsIn: 7, ticketCost: "10 akibaMiles for 1 ticket" },
  { image: nft2, title: "CryptoPunk #789", endsIn: 3, ticketCost: "12 akibaMiles" },
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
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [spendSheetOpen, setSpendSheetOpen] = useState(false);
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
      .then(setRaffles)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const formatEndsIn = (ends: number) => {
    const secondsLeft = ends - Math.floor(Date.now() / 1000);
    const days = Math.floor(secondsLeft / (60 * 60 * 24));
    return `${days} days`;
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
          <h3 className="text-lg font-extrabold mb-2">Digital cash raffles</h3>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          {raffles.map((r) => (
            <RaffleCard
              key={r.id}
              image={r.image ?? RaffleImg1}
              title={`${r.rewardPool} ${r.symbol} weekly`}
              endsIn={formatEndsIn(r.ends)}
              ticketCost={`${r.ticketCost} akibaMiles for 1 ticket`}
              locked={false}
              icon={akibaMilesSymbol}
              onClick={() => {
                const img = TOKEN_IMAGES[r.symbol] ?? TOKEN_IMAGES.default
                setSpendRaffle({
                  id: Number(r.id),
                  title: r.description,
                  reward: `${r.ticketCost} akibaMiles`,
                  prize: r.rewardPool ?? "—",
                  endDate: formatEndsIn(r.ends),
                  ticketCost: `${r.ticketCost} akibaMiles`,
                  image: img as StaticImageData,
                  balance: Number(akibaMilesBalance),
                  symbol: r.symbol
                });
                setSpendSheetOpen(true);
              }}
            />
          ))}
        </div>
      </div>

      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Physical goods raffles</h3>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          {physicalGoodsRaffles.map((raffle, idx) => (
            <RaffleCard
              key={idx}
              image={raffle.image}
              title={raffle.title}
              endsIn={`${raffle.endsIn} days` }
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
                  symbol: 'akibaMiles'
                });
                setSpendSheetOpen(true);
              }}
            />
          ))}
        </div>
      </div>
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
              endsIn={`${raffle.endsIn} days` }
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
                  symbol: 'akibaMiles'
                });
                setSpendSheetOpen(true);
              }}
            />
          ))}
        </div>
      </div>


      <div>
        <SectionHeading title="Upcoming games" />
        <div className="flex space-x-3 overflow-x-auto px-4">
          {upcomingGames.map((game, idx) => (
            <GameCard key={idx} name={game.name} date={game.date} image={game.image} />
          ))}
        </div>
      </div>

      {/*      <SpendPartnerQuestSheet open={showPopup} onOpenChange={setSpendSheetOpen} raffle={selectedRaffle} />*/}
      {hasMounted && (<SpendPartnerQuestSheet
        open={spendSheetOpen}
        onOpenChange={setSpendSheetOpen}
        raffle={spendRaffle}
      />)}  </main>
  );
}

export default Page;