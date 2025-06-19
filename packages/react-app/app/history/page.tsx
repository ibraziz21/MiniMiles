"use client"

import HistoryStats from '@/components/history-stats';
import MiniMilesHistoryCard from '@/components/mini-miles-history-card';
import { RaffleCard } from '@/components/raffle-card';
import TransactionHistoryCard from '@/components/transaction-history-card';
import { fetchActiveRaffles, Raffle } from '@/helpers/raffledisplay';
import { RaffleImg1, RaffleImg2, RaffleImg3 } from '@/lib/img';
import { MinimilesSymbol } from '@/lib/svg';
import { StaticImageData } from 'next/image';
import React, { useEffect, useState } from 'react'

const TOKEN_IMAGES: Record<string, StaticImageData> = {
    cUSD: RaffleImg1,
    USDT: RaffleImg2,
    cKES: RaffleImg3,
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
    const [miniMilesBalance, setMiniMilesBalance] = useState('0');
    const [raffles, setRaffles] = useState<Raffle[]>([])
    const [loading, setLoading] = useState(true)
    const [spendSheetOpen, setSpendSheetOpen] = useState(false);

    const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);


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
            <MiniMilesHistoryCard points={Number(miniMilesBalance)} />
            <HistoryStats title='Total Raffles won' stats={"20"} />
            <HistoryStats title='Total prizes won valued in USD' stats={"$ 2,036.80"} />
            <HistoryStats title='Total completed challenges' stats={"14"} />
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