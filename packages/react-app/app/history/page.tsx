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
import { akibaMilesSymbol } from '@/lib/svg';
import { StaticImageData } from 'next/image';
import React, { useEffect, useMemo, useState } from 'react'
import { useMiniMilesHistory } from '@/helpers/txHistory';

const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: akibaMilesSymbol,
};

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

export default function History() {
  const { address, getakibaMilesBalance } = useWeb3();

  const { data: txHistory = [], isLoading: txLoading } = useMiniMilesHistory();
  const [raffles, setRaffles]         = useState<Raffle[]>([]);
  const [loading, setLoading]         = useState(true);
  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");

  const [totalEarned, setTotalEarned] = useState("0");
  const [totalWins,  setTotalWins]    = useState("0");
  const [totalUSDWon, setTotalUSDWon] = useState("$ 0");
  const [totalChallenges, setTotalChallenges] = useState("0");

  /* ── derived: which raffles the wallet joined ───────────────── */
  const joinedRaffleIds = useMemo(
    () =>
      new Set(
        txHistory
          .filter((it) => it.type === "RAFFLE_ENTRY")
          .map((it) => Number(it.roundId)),
      ),
    [txHistory],
  );

  /* ── side-effects: stats, balance, raffles ─────────────────── */
  useEffect(() => {
    if (!address) return;

    fetchTotalCompletedChallenges(address).then((n) => setTotalChallenges(n.toString()));
    fetchTotalRafflesWon(address).then((n) => setTotalWins(n.toString()));
    fetchTotalMiniMilesEarned(address).then((n) => setTotalEarned(n.toFixed(0)));
    fetchTotalRewardsWon(address).then(({ totalUSD }) =>
      setTotalUSDWon(`$ ${totalUSD.toFixed(2)}`),
    );
    getakibaMilesBalance().then(setakibaMilesBalance);
  }, [address, getakibaMilesBalance]);

  useEffect(() => {
    fetchActiveRaffles()
      .then(setRaffles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatEndsIn = (ends: number) => {
    const days = Math.floor((ends - Date.now() / 1000) / 86_400);
    return `${days} days`;
  };

  /* ───────────────────────── render ─────────────────────────── */
  return (
    <main className="pb-24 font-sterling bg-onboarding">
      {/* headline */}
      <div className="px-4 min-h-[110px] flex flex-col justify-around">
        <h1 className="text-2xl font-medium">Your history</h1>
        <h3 className="font-extralight">
          View your akibaMiles gaming stats &amp; history.
        </h3>
      </div>

      {/* top stats */}
      <MiniMilesHistoryCard points={Number(totalEarned)} />
      <HistoryStats title="Total Raffles won" stats={totalWins} />
      <HistoryStats title="Total prizes won valued in USD" stats={totalUSDWon} />
      <HistoryStats title="Total completed challenges" stats={totalChallenges} />

      {/* participating raffles */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Participating Raffles</h3>
        </div>

        {txLoading || loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (() => {
            const participating = raffles.filter((r) =>
              joinedRaffleIds.has(Number(r.id)),
            );

            if (participating.length === 0) {
              return (
                <p className="text-sm text-gray-500">
                  You haven’t joined any raffles yet.
                </p>
              );
            }

            return (
              <div className="flex gap-3 overflow-x-auto">
                {participating.map((r) => {
                  const img = TOKEN_IMAGES[r.symbol] ?? TOKEN_IMAGES.default;
                  return (
                    <RaffleCard
                      key={r.id}
                      image={r.image ?? RaffleImg5}
                      title={`${r.rewardPool} ${r.symbol} weekly`}
                      endsIn={formatEndsIn(r.ends)}
                      ticketCost={`${r.ticketCost} akibaMiles for 1 ticket`}
                      locked={false}
                      icon={akibaMilesSymbol}
                    />
                  );
                })}
              </div>
            );
          })()}
      </div>

      {/* tx history */}
      <div className="px-4 min-h-[110px] flex flex-col justify-around">
        <h1 className="text-2xl font-medium">Transaction history</h1>
        <h3 className="font-extralight">View all your akibaMiles activities.</h3>
      </div>

      {txLoading ? (
        <p className="mx-4 mt-2 text-sm text-gray-500">Loading…</p>
      ) : (
        <TransactionHistoryCard items={txHistory} />
      )}
    </main>
  );
}