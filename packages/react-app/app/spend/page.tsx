"use client";

import DailyChallenges from '@/components/daily-challenge';
import { GameCard } from '@/components/game-card';
import { Hero } from '@/components/Hero';
import MiniPointsCard from '@/components/mini-points-card';
import { RaffleCard } from '@/components/raffle-card';
import { RaffleDetails } from '@/components/raffle-details';
import { SectionHeading } from '@/components/section-heading';
import SpendPartnerQuestSheet from '@/components/spend-partner-quest-sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWeb3 } from '@/contexts/useWeb3';
import { fetchActiveRaffles, Raffle } from '@/helpers/raffledisplay';
import { RaffleImg1, RaffleImg2, RaffleImg3, RaffleImg4, WinImg } from '@/lib/img';
import { MinimilesSymbol } from '@/lib/svg';
import { Question } from '@phosphor-icons/react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

const digitalCashRaffles = [
  { image: RaffleImg1, title: "500 USDT weekly", endsIn: "7 days", ticketCost: "10 MiniMiles for 1 ticket" },
  { image: RaffleImg2, title: "250 USDT", endsIn: "7 days", ticketCost: "6 points for 1 ticket" },
];

const physicalGoodsRaffles = [
  { image: RaffleImg3, title: "Ledger hardware wallet", endsIn: "5 days", ticketCost: "3 MiniMiles for 1 ticket" },
  { image: RaffleImg4, title: "Laptop", endsIn: "4 days", ticketCost: "50 tickets by brand" },
];

const nftRaffles = [
  { image: RaffleImg3, title: "BoredApe #567", endsIn: "3 days", ticketCost: "10 MiniMiles for 1 ticket" },
  { image: RaffleImg2, title: "CryptoPunk #789", endsIn: "2 days", ticketCost: "12 MiniMiles" },
];

const upcomingGames = [
  { name: "Dice", date: "xx/xx/xx", image: "/dice.jpg" },
  { name: "Coin flip", date: "xx/xx/xx", image: "/coin.jpg" },
];

const Page = () => {

  const { address, getUserAddress, getMiniMilesBalance } = useWeb3();
  const [miniMilesBalance, setMiniMilesBalance] = useState('0');
  const [showPopup, setShowPopup] = useState(false);
  const [selectedRaffle, setSelectedRaffle] = useState<any>(null);
  const [raffleSheetOpen, setRaffleSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true)
  const [raffles, setRaffles] = useState<Raffle[]>([])



  useEffect(() => {
    getUserAddress();
  }, []);



  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getMiniMilesBalance(address);
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

  const formatEndsIn = (ends: number) => {
    const secondsLeft = ends - Math.floor(Date.now() / 1000);
    const days = Math.floor(secondsLeft / (60 * 60 * 24));
    return `${days} days`;
  };


  return (
    <main className="pb-24 font-poppins bg-onboarding px-3">
      <div className="px-4 pt-4">
        <h1 className="text-2xl font-bold mt-2">Spend</h1>
        <h3>Win big by entering our Raffles</h3>
      </div>
      <MiniPointsCard points={Number(miniMilesBalance)} />
      <Link
        className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"
        href={"/onboarding"}
      >
        <Question size={24} />
        <h3>How to enter a raffle?</h3>
      </Link>


      <Tabs defaultValue="active" className="mt-5">
        <TabsList>
          <TabsTrigger value="active" className="text-[#219653] bg-[#66D5754D] rounded-full font-bold">Active</TabsTrigger>
          <TabsTrigger value="participating" className="ml-1 text-[#8E8B8B] bg-[#EBEBEB] rounded-full font-bold">Participating</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
        <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Join Raffles</h3>
          <Link href='/spend'>
            <span className="text-sm text-green-600 hover:underline">View more ›</span>
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto">
          {raffles.map((r) => (
            <RaffleCard
              key={r.id}
              image={r.image ?? RaffleImg1}
              title={r.description}
              endsIn={formatEndsIn(r.ends)}
              ticketCost={`${r.ticketCost} MiniMiles for 1 ticket`}
              icon={MinimilesSymbol}
              onClick={() => {
                setSelectedRaffle(r);
                setRaffleSheetOpen(true);
              }}
            />
          ))}
        </div>
      </div>
      {selectedRaffle && (
        <RaffleDetails
          open={raffleSheetOpen}
          onOpenChange={setRaffleSheetOpen}
          title={selectedRaffle.description}
          image={selectedRaffle.image ?? RaffleImg1}
          prize={selectedRaffle.rewardPool!}
          pricePerTicket={`${selectedRaffle.ticketCost} MiniMiles`}
          drawDate={formatEndsIn(selectedRaffle.ends)}
          balance={Number(miniMilesBalance)}
        />
      )}

          <div>
            <div className="">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-sm font-bold">Physical Goods raffles</h3>
                <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
                  See all ›
                </Link>
              </div>
              <div className="flex space-x-3 overflow-x-auto px-4">
                {physicalGoodsRaffles.map((raffle, idx) => (
                  <RaffleCard
                    key={idx}
                    image={raffle.image}
                    title={raffle.title}
                    endsIn={raffle.endsIn}
                    ticketCost={raffle.ticketCost}
                    icon={MinimilesSymbol}
                    onClick={() => {
                      setSelectedRaffle(raffle);
                      setShowPopup(true);
                    }}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-sm font-bold">NFT raffles</h3>
                <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
                  See all ›
                </Link>
              </div>
              <div className="flex space-x-3 overflow-x-auto px-4">
                {nftRaffles.map((raffle, idx) => (
                  <RaffleCard
                    key={idx}
                    image={raffle.image}
                    title={raffle.title}
                    endsIn={raffle.endsIn}
                    ticketCost={raffle.ticketCost}
                    icon={MinimilesSymbol}
                    onClick={() => {
                      setSelectedRaffle(raffle);
                      setShowPopup(true);
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
          </div>
        </TabsContent>
        <TabsContent value="participating">Participating Raffles here</TabsContent>
      </Tabs>
      <SpendPartnerQuestSheet open={showPopup} onOpenChange={setShowPopup} raffle={selectedRaffle} />
    </main>
  );
}

export default Page;