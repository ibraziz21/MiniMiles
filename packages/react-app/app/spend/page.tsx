"use client";

import DailyChallenges from '@/components/daily-challenge';
import { GameCard } from '@/components/game-card';
import { Hero } from '@/components/Hero';
import MiniPointsCard from '@/components/mini-points-card';
import { RaffleCard } from '@/components/raffle-card';
import { SectionHeading } from '@/components/section-heading';
import { WinImg } from '@/lib/img';
import { MinimilesSymbol } from '@/lib/svg';
import React from 'react';

const digitalCashRaffles = [
  { image: WinImg, title: "500 USDT weekly", endsIn: "7 days", ticketCost: "10 MiniMiles for 1 ticket" },
  { image: WinImg, title: "250 USDT", endsIn: "7 days", ticketCost: "6 points for 1 ticket" },
];

const physicalGoodsRaffles = [
  { image: WinImg, title: "Ledger hardware wallet", endsIn: "5 days", ticketCost: "3 MiniMiles for 1 ticket" },
  { image: WinImg, title: "Laptop", endsIn: "4 days", ticketCost: "50 tickets by brand" },
];

const nftRaffles = [
  { image: WinImg, title: "BoredApe #567", endsIn: "3 days", ticketCost: "10 MiniMiles for 1 ticket" },
  { image: WinImg, title: "CryptoPunk #789", endsIn: "2 days", ticketCost: "12 MiniMiles" },
];

const upcomingGames = [
  { name: "Dice", date: "xx/xx/xx", image: "/dice.jpg" },
  { name: "Coin flip", date: "xx/xx/xx", image: "/coin.jpg" },
];

const Page = () => {
  return (
    <main className="pb-24 font-poppins">
      <div className="px-4 pt-4">
        <h1 className="text-2xl font-bold mt-2">Earn</h1>
        <h3>Complete challenges and quests to earn MiniMiles.</h3>
      </div>
      <MiniPointsCard points={120} />

      <DailyChallenges />
      

      <SectionHeading title="Join physical goods raffles" />
      <div className="flex space-x-3 overflow-x-auto px-4">
        {physicalGoodsRaffles.map((raffle, idx) => (
          <RaffleCard
            key={idx}
            image={raffle.image}
            title={raffle.title}
            endsIn={raffle.endsIn}
            ticketCost={raffle.ticketCost}
            icon={MinimilesSymbol}
          />
        ))}
      </div>

      <SectionHeading title="Join NFT Raffles" />
      <div className="flex space-x-3 overflow-x-auto px-4">
        {nftRaffles.map((raffle, idx) => (
          <RaffleCard
            key={idx}
            image={raffle.image}
            title={raffle.title}
            endsIn={raffle.endsIn}
            ticketCost={raffle.ticketCost}
            icon={MinimilesSymbol}
          />
        ))}
      </div>

      <SectionHeading title="Upcoming games" />
      <div className="flex space-x-3 overflow-x-auto px-4">
        {upcomingGames.map((game, idx) => (
          <GameCard key={idx} name={game.name} date={game.date} image={game.image} />
        ))}
      </div>
    </main>
  );
}

export default Page;