"use client"

import HistoryStats from '@/components/history-stats';
import MiniMilesHistoryCard from '@/components/mini-miles-history-card';
import { RaffleCard } from '@/components/raffle-card';
import TransactionHistoryCard from '@/components/transaction-history-card';
import { useWeb3 } from '@/contexts/useWeb3';
import { fetchTotalCompletedChallenges } from '@/helpers/fetchTotalCompleteChallenges';
import { fetchTotalRewardsWon } from '@/helpers/historicRewards';
import { fetchTotalMiniMilesEarned } from '@/helpers/historyBalance';
import { fetchTotalRafflesWon } from '@/helpers/historyRaffleWon';
import { fetchActiveRaffles, Raffle } from '@/helpers/raffledisplay';
import { RaffleImg1, RaffleImg2, RaffleImg3, RaffleImg5 } from '@/lib/img';
import { MinimilesSymbol } from '@/lib/svg';
import { StaticImageData } from 'next/image';
import React, { useEffect, useState } from 'react'

const TOKEN_IMAGES: Record<string, StaticImageData> = {
    cUSD: RaffleImg1,
    USDT: RaffleImg2,
    Miles: RaffleImg5,
    // default fallback:
    default: MinimilesSymbol,
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


const History = () => {
    const { address, getUserAddress, getMiniMilesBalance } = useWeb3();
    const [miniMilesBalance, setMiniMilesBalance] = useState('0');
    const [raffles, setRaffles] = useState<Raffle[]>([])
    const [loading, setLoading] = useState(true)
    const [spendSheetOpen, setSpendSheetOpen] = useState(false);

    const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);

    const [totalEarned, setTotalEarned] = useState('0');

    const [totalWins, setTotalWins] = useState("0");

    const [totalUSDWon, setTotalUSDWon] = useState("$ 0");
    const [totalChallenges, setTotalChallenges] = useState("0");

    useEffect(() => {
        const fetchChallenges = async () => {
          if (!address) return;
          try {
            const total = await fetchTotalCompletedChallenges(address);
            setTotalChallenges(total.toString());
          } catch (e) {
            console.error("Error fetching completed challenges:", e);
          }
        };
        fetchChallenges();
      }, [address]);

    useEffect(() => {
        const fetchRewards = async () => {
          if (!address) return;
          try {
            const { totalUSD } = await fetchTotalRewardsWon(address);
            setTotalUSDWon(`$ ${totalUSD.toFixed(2)}`);
          } catch (e) {
            console.error("Error fetching rewards won:", e);
            setTotalUSDWon("$ 0");
          }
        };
      
        fetchRewards();
      }, [address]);
      

    useEffect(() => {
        const fetchWins = async () => {
          if (!address) return;
          try {
            const wins = await fetchTotalRafflesWon(address);
            setTotalWins(wins.toString());
          } catch (e) {
            console.error("Error fetching total raffles won:", e);
          }
        };
        fetchWins();
      }, [address]);
      

useEffect(() => {
  const fetchTotalEarned = async () => {
    if (!address) return;
    try {
      const earned = await fetchTotalMiniMilesEarned(address);
      setTotalEarned(earned.toFixed(0));
    } catch (e) {
      console.error(e);
    }
  };
  fetchTotalEarned();
}, [address]);

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


    const formatEndsIn = (ends: number) => {
        const secondsLeft = ends - Math.floor(Date.now() / 1000);
        const days = Math.floor(secondsLeft / (60 * 60 * 24));
        return `${days} days`;
    };

    return (
        <main className="pb-24 font-sterling bg-onboarding">
            <div className="px-4 min-h-[110px]  flex flex-col justify-around">
                <h1 className="text-2xl font-medium">Your history</h1>
                <h3 className='font-extralight'>View your MiniMiles gaming stats & history.</h3>
            </div>
            <MiniMilesHistoryCard points={Number(totalEarned)} />
            <HistoryStats title='Total Raffles won' stats={totalWins} />
            <HistoryStats title='Total prizes won valued in USD' stats={totalUSDWon} />
            <HistoryStats title='Total completed challenges' stats={totalChallenges} />
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
                            ticketCost={`${r.ticketCost} MiniMiles for 1 ticket`}
                            locked={false}
                            icon={MinimilesSymbol}
                            onClick={() => {
                                const img = TOKEN_IMAGES[r.symbol] ?? TOKEN_IMAGES.default
                                setSpendRaffle({
                                    id: Number(r.id),
                                    title: r.description,
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
            <div className="px-4 min-h-[110px]  flex flex-col justify-around">
                <h1 className="text-2xl font-medium">Transaction history</h1>
                <h3 className='font-extralight'>View all your MiniMiles activities.</h3>
            </div>
            <TransactionHistoryCard />
        </main>
    )
}

export default History