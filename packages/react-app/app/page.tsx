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
import { RaffleImg1, RaffleImg2, WinImg } from "@/lib/img";
import { Celo, MinimilesSymbol } from "@/lib/svg";
import { useEffect, useState } from "react";
import AccountSheet from "@/components/account-sheet";
import ContactSheet from "@/components/contact-sheet";
import DailyChallengeSheet from "@/components/daily-challenge-sheet";
import { fetchActiveRaffles,Raffle } from "@/helpers/raffledisplay";
import Link from "next/link";

const digitalCashRaffles: Raffle[] = [
  {
    id: "raffle-usdt-weekly",
    starts: Math.floor(Date.now() / 1000),
    ends: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    maxTickets: 1000,
    image: RaffleImg1,
    ticketsSold: 450,
    rewardToken: "0x0000000000000000000000000000000000000001", // dummy ERC20 address
    rewardPool: "500000000", // example: 500 USDT (in smallest units if needed)
    ticketCost: 10,
    description: "Enter to win 500 USDT this week!",
    status: "active",
  },
  {
    id: "raffle-usdt-250",
    starts: Math.floor(Date.now() / 1000),
    ends: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    maxTickets: 1000,
    image: RaffleImg2,
    ticketsSold: 300,
    rewardToken: "0x0000000000000000000000000000000000000002",
    rewardPool: "250000000",
    ticketCost: 6,
    description: "Try your luck to win 250 USDT!",
    status: "active",
  },
];

const physicalGoodsRaffles: Raffle[] = [
  {
    id: "raffle-ledger-wallet",
    starts: Math.floor(Date.now() / 1000),
    ends: Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60,
    maxTickets: 500,
    image: RaffleImg1,
    ticketsSold: 120,
    rewardToken: "PHYSICAL_LEDGER", // Or a dummy token to represent physical goods
    rewardPool: undefined,
    ticketCost: 3,
    description: "Win a Ledger hardware wallet!",
    status: "active",
  },
  {
    id: "raffle-laptop",
    starts: Math.floor(Date.now() / 1000),
    ends: Math.floor(Date.now() / 1000) + 4 * 24 * 60 * 60,
    maxTickets: 100,
    image: RaffleImg2,
    ticketsSold: 80,
    rewardToken: "PHYSICAL_LAPTOP",
    rewardPool: undefined,
    ticketCost: 50,
    description: "Get a chance to win a high-end laptop!",
    status: "active",
  },
];


const nftRaffles: Raffle[] = [
  {
    id: "raffle-boredape-567",
    starts: Math.floor(Date.now() / 1000),
    ends: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
    maxTickets: 200,
    image: RaffleImg1,
    ticketsSold: 75,
    rewardToken: "0xNFTBOREDAPE567", // dummy NFT token ID/address
    rewardPool: undefined,
    ticketCost: 10,
    description: "Win BoredApe #567 NFT!",
    status: "active",
  },
  {
    id: "raffle-cryptopunk-789",
    starts: Math.floor(Date.now() / 1000),
    ends: Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60,
    maxTickets: 200,
    image: RaffleImg2,
    ticketsSold: 120,
    rewardToken: "0xNFTCRYPTOPUNK789",
    rewardPool: undefined,
    ticketCost: 12,
    description: "Win CryptoPunk #789 NFT!",
    status: "active",
  },
];

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
  const [selectedRaffle, setSelectedRaffle] = useState<Raffle>({
    id: "raffle1",
    rewardToken: "500 USDT weekly",
    starts: 56532,
    ends: 44232,
    maxTickets: 1000,
    ticketsSold: 300,
    ticketCost: 10,
    image: RaffleImg2,
    description: "Win 500 USDT this week!",
    status: "active",
  });
  

  
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

  if (loading) return <div>Loading…</div>

  const formatEndsIn = (ends: number) => {
    const secondsLeft = ends - Math.floor(Date.now() / 1000);
    const days = Math.floor(secondsLeft / (60 * 60 * 24));
    return `${days} days`;
  };

  return (
    <main className="pb-24 font-poppins">
      <DashboardHeader name="Jash.mini" />
      <PointsCard points={Number(miniMilesBalance)} />
      <DailyChallenges />
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Join Raffles</h3>
          <Link href='/spend'>
            <span className="text-sm text-green-600 hover:underline">View more ›</span>
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto mt-4">
          {raffles.map((raffle, ind) => {
            return <RaffleCard
              key={ind}
              image={RaffleImg1}
              title={raffle.rewardToken}
              endsIn={formatEndsIn(raffle.ends)}
              ticketCost={`${raffle.ticketCost} MiniMiles for 1 ticket`}
              icon={MinimilesSymbol}
              setShowPopup={setShowPopup}
              onClick={() => {
                setSelectedRaffle(raffle);
                setShowPopup(true);
              }}
            />
          })}
        </div>
      </div>
      <SectionHeading title="Join digital cash raffles" />
      <div className="flex space-x-3 overflow-x-auto px-4 whitespace-nowrap scrollbar-hide">
        {digitalCashRaffles.map((raffle, idx) => (
          <RaffleCard
            key={idx}
            image={raffle.image}
            title={raffle.description}
            endsIn={formatEndsIn(raffle.ends)}
            ticketCost={`${raffle.ticketCost} MiniMiles for 1 ticket`}
            icon={MinimilesSymbol}
            setShowPopup={setShowPopup}
            onClick={() => {
              setSelectedRaffle(raffle);
              setShowPopup(true);
            }}
          />
        ))}
      </div>

      <SectionHeading title="Join physical goods raffles" />
      <div className="flex space-x-3 overflow-x-auto px-4">
        {physicalGoodsRaffles.map((raffle, idx) => (
          <RaffleCard
            key={idx}
            image={raffle.image}
            title={raffle.description}
            endsIn={formatEndsIn(raffle.ends)}
            ticketCost={`${raffle.ticketCost} MiniMiles for 1 ticket`}
            icon={MinimilesSymbol}
            setShowPopup={setShowPopup}
            onClick={() => {
              setSelectedRaffle(raffle);
              setShowPopup(true);
            }}
          />
        ))}
      </div>

      <SectionHeading title="Join NFT Raffles" />
      <div className="flex space-x-3 overflow-x-auto px-4">
        {nftRaffles.map((raffle, idx) => (
          <RaffleCard
            key={idx}
            image={raffle.image}
            title={raffle.description}
            endsIn={formatEndsIn(raffle.ends)}
            ticketCost={`${raffle.ticketCost} MiniMiles for 1 ticket`}
            icon={MinimilesSymbol}
            setShowPopup={setShowPopup}
            onClick={() => {
              setSelectedRaffle(raffle);
              setShowPopup(true);
            }}
          />
        ))}
      </div>

      <SectionHeading title="Upcoming games" />
      <div className="flex space-x-3 overflow-x-auto px-4">
        {upcomingGames.map((game, idx) => (
          <GameCard key={idx} name={game.name} date={game.date} image={game.image} />
        ))}
      </div>

      <DailyChallengeSheet open={showPopup} onOpenChange={setShowPopup} raffle={selectedRaffle} />
      <div className="mx-4 mt-6 space-y-4">
        <AccountSheet />
        <ContactSheet />
      </div>
    </main>
  );
}
